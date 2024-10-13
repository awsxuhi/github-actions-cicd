import os
import json
import hashlib
import boto3

from aws_lambda_powertools import Logger
from pydantic import BaseModel
from typing import Any, Dict, List

from genai_core.csdc.usecase import BaseUsecase
from genai_core.csdc.websocket import CustomFinalOutputCallbackHandler
from genai_core.csdc.tools import (get_temperature_from_string, get_weekday_of_date, get_today_date, get_weekday_today )
from genai_core.csdc.tools import AwsListEc2Instances, AwsShutdownAnEc2Instance, AwsStartAnEc2Instance, AwsDocReader
from genai_core.csdc.models import create_sagemaker_embeddings_from_js_model
from genai_core.langchain.agents.structured_chat.prompt import FORMAT_INSTRUCTIONS, PREFIX, SUFFIX

from langchain.agents import AgentType, initialize_agent, load_tools, Tool, StructuredChatAgent
from langchain.agents.agent_toolkits import create_retriever_tool
from langchain.chains import LLMChain
from langchain.chains.router import MultiPromptChain
from langchain.chains.router.embedding_router import EmbeddingRouterChain
from langchain.chains.router.llm_router import LLMRouterChain, RouterOutputParser
from langchain.chains.router.multi_prompt_prompt import MULTI_PROMPT_ROUTER_TEMPLATE
from langchain.embeddings import BedrockEmbeddings, OpenAIEmbeddings
from langchain.memory import ConversationBufferWindowMemory
from langchain.prompts import (
	PromptTemplate,
	ChatPromptTemplate,
	MessagesPlaceholder,
	SystemMessagePromptTemplate,
	HumanMessagePromptTemplate,
)
from langchain.schema import AgentAction, Document

from langchain.tools import YouTubeSearchTool
from langchain.vectorstores import OpenSearchVectorSearch

from opensearchpy import RequestsHttpConnection

logger = Logger()

#************************************************************************************************************

class PaletteUsecase(BaseUsecase):
	def get_memory(self, return_messages=True, k=None):
		# Here the variables match what were used in qa_with_history_template
		# Ref: return self.buffer_as_messages if self.return_messages else self.buffer_as_str
		# Key point: set 'return_messages'=False to get a good format (string) of chat history. The format is the same
		# as the result of get_chat_history(chat_history.messages)
		if k is None:
			k = self.chat_history_window
  
		memory = ConversationBufferWindowMemory(
			memory_key = "chat_history",
			input_key = "input", 	# Change the input_key back to "input", otherwise, KeyError: 'question'
			output_key = "output", 	# Added for Agent use case, otherwise, you will encounter the error of got dict_keys(['output', 'intermediate_steps'])
			chat_memory = self.chat_history,
			return_messages = return_messages,
			k = k,
			human_prefix = "Human",				# the default value
			ai_prefix = "Assistant",			# the default value is "AI", Claude expect it's Assistant instead of AI
		)  # By default, k=10
		return memory

	# +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	def chatbot(self):
		self.llm = self.get_llm()
		self.memory = self.get_memory()
		
		chain = LLMChain(
			llm = self.llm, 
			prompt = self.get_chatbot_prompt(doc_reader_type="langchain"), 
			verbose = True, 
			memory = self.memory
			)

		response_from_chain = chain({"question": self.question})
		print(f"'+++++++++++ response_from_chain is: {response_from_chain}")
		
		metadata = {
			"text2text_model": self.env["text2text_model"],
			"temperature": self.env["temperature"],
			"chat_history_window": self.env["chat_history_window"],
			"files": self.env["files"],
		}
		if self.env["files"]:
			metadata["files"] = self.env["files"]
			
		self.chat_history.add_metadata(metadata)

		final_response_with_metadata = {
			"sessionId": self.session_id,
			"type": "text",
			"content": response_from_chain["text"],
			"metadata": metadata,
		}
		
		return final_response_with_metadata

	# +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	def serialize_agent_action(self, step):
		"""Convert a step into a serializable dictionary format. The step might be a tuple of (AgentAction, str)."""
		if isinstance(step, tuple) and len(step) == 2 and isinstance(step[0], AgentAction):
			 # 检查 result 是否是单个 Document 实例或包含 Document 实例的列表
			if isinstance(step[1], Document):
				serialized_result = step[1].dict()  # 假设 Document 有 to_dict 方法
			elif isinstance(step[1], list) and all(isinstance(elem, Document) for elem in step[1]):
				serialized_result = [elem.dict() for elem in step[1]]  # 对列表中的每个 Document 调用 to_dict
			else:
				serialized_result = self.serialize_base_model(step[1])

			return {
				"action": {
					"tool": step[0].tool,
					"tool_input": step[0].tool_input,
					"log": step[0].log,
					"type": step[0].type
				},
				"result": serialized_result
			}
		# below code won't be executed actually
		elif isinstance(step, AgentAction):
			return {
				"tool": step.tool,
				"tool_input": step.tool_input,
				"log": step.log,
				"type": step.type
			}
		else:
			return step

	# +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	@classmethod
	def serialize_base_model(cls, obj: Any) -> Any:
		"""
		Recursively serialize objects that are instances of BaseModel.
		"""
		if isinstance(obj, BaseModel):
			return obj.dict(exclude_none=True)
		elif isinstance(obj, dict):
			return {key: cls.serialize_base_model(value) for key, value in obj.items()}
		elif isinstance(obj, list):
			return [cls.serialize_base_model(element) for element in obj]
		else:
			return obj

	# +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	@classmethod
	def serialize_intermediate_steps(cls, steps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
		"""
		Serialize all intermediate steps, ensuring all BaseModel objects are converted to dictionaries.
		"""
		return [cls.serialize_base_model(step) for step in steps]

	# +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	def get_embeddings_and_index_name_multi(self, embedding_model, *knowledge_bases):
		"""
		Get embeddings and index names for multiple knowledge bases using variable arguments.

		Args:
			embedding_model: Model used for embeddings (e.g., 'OpenAI', 'Bedrock').
			*knowledge_bases: Variable number of knowledge base names.

		Returns:
			Embeddings instance followed by index names for each knowledge base.
		
		Raises:
			Exception: If an unknown embedding model is provided.
		"""
		try:
			# Create embeddings instance based on the provided model
			if embedding_model == "OpenAI":
				embeddings = OpenAIEmbeddings()
			elif embedding_model == "Bedrock":
				embeddings = BedrockEmbeddings(model_id="amazon.titan-embed-text-v1")
			else:
				embeddings = create_sagemaker_embeddings_from_js_model(
					embeddings_model_endpoint_name="buffer-embedding-bge-endpoint",
					aws_region=os.environ['AWS_REGION'],
				)

			# Generate index names for each knowledge base
			index_names = []
			for knowledge_base in knowledge_bases:
				index_name = f"{knowledge_base.lower()}_{embedding_model.lower()}_{hashlib.md5(knowledge_base.encode()).hexdigest()}"
				index_names.append(index_name)

		except Exception as e:
			msg = f"Error in get_embeddings_and_index_name(). [Detailed Error Message]: {str(e)}"
			logger.error(msg)
			raise Exception(msg)

		return embeddings, *index_names

	# +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	def get_vector_stores_from_indices(self, embeddings, *index_names):
		"""
		Create OpenSearchVectorSearch instances for multiple index names.

		Args:
			*index_names: Variable number of index names.

		Returns:
			A list of OpenSearchVectorSearch instances, one for each index name.
		"""
		vector_stores = []
		for index_name in index_names:
			vector_store = OpenSearchVectorSearch(
				embedding_function=embeddings,
				index_name=index_name,
				opensearch_url=[
					{
						"host": os.environ.get("OPEN_SEARCH_ENDPOINT"),
						"port": 443,
					}
				],
				http_auth=(self.master_user_username, self.master_user_password),
				timeout=300,
				use_ssl=True,
				verify_certs=True,
				connection_class=RequestsHttpConnection,
			)
			vector_stores.append(vector_store)

		return vector_stores


	# +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	def get_temperature_agent(self):
		is_admin_str = os.environ.get("is_admin", "False")  # get the string from environment
		is_admin = is_admin_str.lower() == "true"  # Convert a string to a boolean value, case-insensitive.
		print(f"++++++ is_admin: {is_admin}")
  
		self.llm = self.get_llm(is_admin=is_admin) if self.show_reasoning_acting_steps else self.get_llm(callbacks=CustomFinalOutputCallbackHandler, is_admin=is_admin)
		self.memory = self.get_memory()
  
		# Step1: Tools
		tool_get_temperature = Tool.from_function(
			name = "Weather Tool",
	  		func = get_temperature_from_string,
			description = "useful for answering questions about the temperatures for weekday. To use this tool, you must provide only the weekday (one of the values of 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday' and 'Sunday') for which you need to know the temperature to the tool as the action input, without any additional parameters. All temperatures are in Celsius, and it is assumed by default that human inquiries are about temperatures in Celsius. Today is assumed to be Friday by default.",
			# args_schema = WeekdaySchema # pydantic.v1.error_wrappers.ValidationError: 1 validation error for Tool args_schema subclass of BaseModel expected (type=type_error.subclass; expected_class=BaseModel)
		)
		tools = [tool_get_temperature]

		# Step2: Agent
		# initialize_agent -> class AgentExecutor(Chain)
		max_iterations = 12 if self.text2text_model == "Bedrock"  else 6
		agent = initialize_agent(
			tools = tools, 
   			llm = self.llm, 
	  		agent = AgentType.STRUCTURED_CHAT_ZERO_SHOT_REACT_DESCRIPTION, 
			verbose = True,
		 	ai_prefix = "Assistant",
			human_prefix = "Human",
			prefix = PREFIX,
			max_iterations = max_iterations,
			return_intermediate_steps = True,
		)
  
		# Step3: Run the agent
		# class StructuredChatAgent(Agent).create_prompt(): input_variables = ["input", "agent_scratchpad"]
		# ++++++ agent.input_keys: ['input']
		# ++++++ agent.output_keys: ['output', 'intermediate_steps']
		# Create a dictionary that includes all necessary inputs. Regarding the keys in the dictionary, refer to the values of input_variables mentioned earlier.
		inputs = {'input': self.question}

		# use __call__ to execute. __call__ will invoke _call
		response = agent(inputs)
		logger.info(f"++++++ response: {response}")
		# ++++++ response: {
		# 	'input': '周三的气温是多少？', 
		# 	'output': ' 周三的气温是13摄氏度。', 
		# 	'intermediate_steps': [
		# 		(AgentAction(tool='Weather Tool', tool_input='Wednesday', log=' 好的,让我使用天气工具来回答您的问题。\n\nAction:\n```json\n{\n  "action": "Weather Tool",\n  "action_input": "Wednesday"\n}\n```\n\n'), '13')
		# 		]
		# 	}
  
		# serialize intermediate_steps
		# The following two approaches bring the same result. You can use either of them. I prefer the latter one.
		intermediate_steps_serializable_fn = [self.serialize_agent_action(step) for step in response.get("intermediate_steps", [])]
		logger.info(f"++++++ intermediate_steps_serializable_fn: {intermediate_steps_serializable_fn}")
		intermediate_steps_serializable = [{"action": step[0].dict(), "result": step[1]} for step in response.get("intermediate_steps", [])]
		logger.info(f"++++++ intermediate_steps_serializable: {intermediate_steps_serializable}")
  
		metadata = {
			"text2text_model": self.env["text2text_model"],
			"temperature": self.temperature,
			"chat_history_window": self.chat_history_window,
			"reasoning_acting_steps": intermediate_steps_serializable,
		}
  
		if self.env["files"]:
			metadata["files"] = self.env["files"]
   
		self.chat_history.add_metadata(metadata)

		final_response_with_metadata = {
			"sessionId": self.session_id,
			"type": "text",
			"content": response["output"],
			"metadata": metadata,
		}
	
		return final_response_with_metadata
	
	# +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	def default_agent(self):
		# Router
		# Ref: https://python.langchain.com/docs/expression_language/how_to/routing
		# Ref: https://python.langchain.com/docs/modules/chains/foundational/router
		from langchain_core.output_parsers import StrOutputParser
		routing_llm = self.get_llm(streaming=False)
		# memory = self.get_memory()
		template = ChatPromptTemplate.from_messages([
			("system", "You are an Assistant that is classifying questions by their intention.\n\n"
					"Question:\n"
					"<question>\n"
					"{question}\n"
					"</question>\n\n"
					"Categories are:\n"
					"(A) Asking for generating images\n"
					"(B) Given four numbers, the task is to check if there is a way to achieve the number 24 using only the four basic arithmetic operations: addition, subtraction, multiplication, and division. This challenge is commonly known as 'Make 24' or 'The 24 Game'.\n"
					# "(C) Due to a typo, grammatical error, or the question being too brief to discern clear intent, the user needs to rephrase their question and provide additional information.\n"
					"(D) Others"),
			("human", "Based on the intent of the question, select the category of the question. Your response should be in the format of '(A)', '(B)', '(C)', etc. If you believe the question category is '(A)', then also reply with the content description of the image to be generated and the number of images, separated by a comma. If the user does not mention the number of images, then default to generating 1 image. For example, if the question is 'Please help me generate 2 images featuring Optimus Prime from Transformers,' then your reply should be '(A),images featuring Optimus Prime from Transformers,2'. If the question is 'Generate 3 images of a puppy running on the beach', then your reply should be '(A),a puppy running on the beach,3'. If the question is 'Three boys in a high jump competition', then your reply should be '(A),three boys in a high jump competition,1'.")
		])
  
		chain = LLMChain(
			llm = routing_llm, 
			prompt = template,
			verbose = True, 
			# memory = memory
			)

		response_from_chain = chain({"question": self.question})
		print(f"'+++++++++++ response_from_chain is: {response_from_chain}")

		cleaned_text = response_from_chain["text"].strip().lower()
    
		if cleaned_text.startswith("(a)"):
			from genai_core.csdc.usecase import ImageUsecase
			image = ImageUsecase(self.message)
			values = cleaned_text.split(",")
			content_of_images = ""
			number = 1  
   
			if len(values) > 2:
				try:
					content_of_images = values[1].strip()
					number = int(values[2])
				except Exception:
					content_of_images = values[1].strip()
			elif len(values) == 2:
				content_of_images = values[1].strip()
			else:
				content_of_images = values[1].strip()
			print(f"++++++ content of images: {content_of_images}, number of images: {number}")
			final_response_with_metadata = image.run(content_of_images, number)
			return final_response_with_metadata

		elif cleaned_text.startswith("(b)"):
			try:
				payload = {
					"question": self.question,
					"api_key": os.environ['OPENAI_API_KEY'],
					"base_url": os.environ['OPENAI_API_BASE'],
					"text2text_model": self.text2text_model,
				}
				lambda_client = boto3.client('lambda')
				res = lambda_client.invoke(
					FunctionName = "sagemind-autogen-code",
					InvocationType = 'RequestResponse',
					Payload = json.dumps(payload)
				)
  	
				# 确保安全地读取和关闭Payload
				with res['Payload'] as payload_stream:
					res_json = json.loads(payload_stream.read().decode("utf-8"))
				print(f"++++++ res_json: {res_json}")
		
				metadata = {
					"text2text_model": self.env["text2text_model"],
					"temperature": self.temperature,
					"chat_history_window": self.chat_history_window,
					"autogen_chat_messages": res_json["chat_messages"],
				}
		
				if self.env["files"]:
					metadata["files"] = self.env["files"]
	
				human_message = BaseMessage(
					content=self.question,
					type="human",
				)
				ai_message = BaseMessage(
					content=res_json["last_message"],
					type="ai",
					additional_kwargs=metadata
				)

				self.chat_history.add_message(message=human_message)
				self.chat_history.add_message(message=ai_message)

				final_response_with_metadata = {
					"sessionId": self.session_id,
					"type": "text",
					"content": res_json["last_message"],
					"metadata": metadata,
				}
				return final_response_with_metadata

			except Exception as e:
				metadata = {
					"text2text_model": self.env["text2text_model"],
					"temperature": self.temperature,
					"chat_history_window": self.chat_history_window,
				}
		
				if self.env["files"]:
					metadata["files"] = self.env["files"]
	
				final_response_with_metadata = {
					"sessionId": self.session_id,
					"type": "text",
					"content": f"对不起，我执行过程中出现异常，这条对话将不会保存在聊天记录里，错误信息为：{str(e)}",
					"metadata": metadata,
				}
				return final_response_with_metadata
   
		
		# elif cleaned_text.startswith("(c)"):
		# 	metadata = {
		# 		"text2text_model": self.env["text2text_model"],
		# 		"temperature": self.temperature,
		# 		"chat_history_window": self.chat_history_window,
		# 	}
	
		# 	if self.env["files"]:
		# 		metadata["files"] = self.env["files"]
	
 
		# 	human_message = BaseMessage(
		# 		content=self.question,
		# 		type="human",
		# 	)
		# 	ai_message = BaseMessage(
		# 		content="我不知道如何帮助你，请重新提问，将问题描述得更加详细和清楚。",
		# 		type="ai",
		# 		additional_kwargs=metadata
		# 	)

		# 	self.chat_history.add_message(message=human_message)
		# 	self.chat_history.add_message(message=ai_message)

		# 	final_response_with_metadata = {
		# 		"sessionId": self.session_id,
		# 		"type": "text",
		# 		"content": "我不知道如何帮助你，请重新提问，将问题描述得更加详细和清楚。",
		# 		"metadata": metadata,
		# 	}
		# 	return final_response_with_metadata

		else:
			return self.default_agent_with_tools()

	# +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	def default_agent_with_tools(self):

		is_admin_str = os.environ.get("is_admin", "False")  # get the string from environment
		is_admin = is_admin_str.lower() == "true"  # Convert a string to a boolean value, case-insensitive.
		print(f"++++++ is_admin: {is_admin}")
  
		self.llm = self.get_llm(is_admin=is_admin) if self.show_reasoning_acting_steps else self.get_llm(callbacks=CustomFinalOutputCallbackHandler, is_admin=is_admin)
		
		self.master_user_username = os.environ["OPENSEARCH_MASTER_USER_USERNAME"]
		self.master_user_password = os.environ["OPENSEARCH_MASTER_USER_PASSWORD"]
		os.environ["OPEN_SEARCH_ENDPOINT"] = "vpc-sagemind-dkzcnxsleqgjosbijmq24brggq.us-east-1.es.amazonaws.com"
  
		self.k = self.env.get("k", 3)
		self.embedding_model = self.env.get("embedding_model", "CSDC")
		
		embeddings, index_name_cei, index_name_dth = self.get_embeddings_and_index_name_multi(self.embedding_model, "cei", "dth")
		vector_store_cei, vector_store_dth = self.get_vector_stores_from_indices(embeddings, index_name_cei, index_name_dth)
		retriever_cei = vector_store_cei.as_retriever(search_type="similarity", search_kwargs={"k": self.k})
		retriever_dth = vector_store_dth.as_retriever(search_type="similarity", search_kwargs={"k": self.k})

  
		# Step 1: Tools
		tool_cei = create_retriever_tool(
			retriever_cei,
			"CEI Customer Engagement Incentive",
			"This tool can be used to answer questions related to CEI (Customer Engagement Incentive), which is a program with AWS's internal partner teams. It offers a set of guidelines to motivate partners to assist AWS in engaging with clients.",
		)

		tool_dth = create_retriever_tool(
			retriever_dth,
			"DTH Data Transfer Hub",
			"This tool can be used to answer questions related to DTH (i.e., Data Transfer Hub ), which is an AWS solution designed to assist users with cross-border (between China and overseas) data transfer for object storage, such as transferring data from an S3 bucket in the US region to an S3 bucket in the China region. It also facilitates data migration from other cloud platforms like Alibaba Cloud and Tencent Cloud to AWS S3.",
		)

		tool_get_temperature = Tool.from_function(
			name = "Weather Tool",
	  		func = get_temperature_from_string,
			description = "useful for answering questions about the temperatures for weekday. To use this tool, you must provide only the weekday (one of the values of 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday' and 'Sunday') for which you need to know the temperature to the tool as the action input, without any additional parameters. All temperatures are in Celsius, and it is assumed by default that human inquiries are about temperatures in Celsius. To determine the day of the week for a specific date, you typically need to know today's date first. Then, calculate the date you want to inquire about. After establishing the date, you can find out the day of the week using tool 'Return Weekday of Date Tool'. Finally, use the day of the week information to look up the temperature.",
			# args_schema = WeekdaySchema # pydantic.v1.error_wrappers.ValidationError: 1 validation error for Tool args_schema subclass of BaseModel expected (type=type_error.subclass; expected_class=BaseModel)
		)

		tool_get_weekday_of_date = Tool.from_function(
			name = "Return Weekday of Date Tool",
	  		func = get_weekday_of_date,
			description = "Useful for determining the day of the week for a given date. This tool is used to calculate the weekday based on a date. Your input needs to be a date string in the YYYY-MM-DD format, and the tool will return the day of the week for that date.",
			# args_schema = DateSchema,
		)

		tool_get_today_date = Tool.from_function(
			name = "Return Date of Today Tool",
	  		func = get_today_date,
			description = "Useful for determining the date of today. This tool is used to check the date of today. It doesn't care what action input is. It always return one of the values of 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday' and 'Sunday'.",
		)

		tool_get_weekday_today = Tool.from_function(
			name = "Return Weekday of Today Tool",
	  		func = get_weekday_today,
			description = "Useful for determining the weekday of today. This tool is used to check the weekday of today. It doesn't care what action input is. It always return the date of today in the YYYY-MM-DD format.",
		)
  
		# tool_arxiv = load_tools(["arxiv"])[0]
		tool_youtube_search = YouTubeSearchTool()
		tool_doc_reader = AwsDocReader(
			table_name = self.lambda_env.SESSIONS_TABLE_NAME, 
			session_id = self.session_id,
			user_id = self.user_id,
			text2text_model = self.text2text_model,
		)
  
		tools = [
	  		tool_cei, 
			tool_dth, 
			tool_get_temperature, 
		 	tool_get_today_date, 
		  	tool_get_weekday_today, 
		   	tool_get_weekday_of_date, 
			tool_youtube_search,
			tool_doc_reader,
		]
  
		tool_from_langchain_tools = load_tools(
	  		["arxiv"], 
			llm = self.llm,
		)
		tools.extend(tool_from_langchain_tools)

		tool_list_ec2_instances = AwsListEc2Instances()
		tool_shutdown_ec2_instances = AwsShutdownAnEc2Instance()
		tool_start_ec2_instances = AwsStartAnEc2Instance()
  
		tools_admin = [
			tool_list_ec2_instances, 
			tool_shutdown_ec2_instances, 
			tool_start_ec2_instances,
		]
  
		if is_admin:
			tools.extend(tools_admin)
		
		# Step 2: Agent
		# initialize_agent -> class AgentExecutor(Chain)
		# https://github.com/langchain-ai/langchain/issues/4000
		# https://github.com/langchain-ai/langchain/issues/2068
		# https://github.com/langchain-ai/langchain/blob/afd96b24606e06f15bec4ee94d0ddfde121d894f/docs/snippets/modules/agents/agent_types/structured_chat.mdx#L203
  
		chat_history_for_memory_prompts = MessagesPlaceholder(variable_name="chat_history")
		self.memory = self.get_memory() 
		print(f"++++++ chat_history_for_memory_prompts: {chat_history_for_memory_prompts}")
		print(f"++++++ chat_history_for_memory_prompts.dict(): {chat_history_for_memory_prompts.dict()}")
		print(f"++++++ chat_history_for_memory_prompts.json(): {chat_history_for_memory_prompts.json()}")
  
		max_iterations = 12 if self.text2text_model == "Bedrock"  else 6
		agent = initialize_agent(
			tools=tools, 
			llm=self.llm, 
			agent=AgentType.STRUCTURED_CHAT_ZERO_SHOT_REACT_DESCRIPTION, 
			agent_kwargs={
				"prefix": PREFIX,
				"suffix": SUFFIX,
				"format_instructions": FORMAT_INSTRUCTIONS,
				"input_variables": ["input", "chat_history", "agent_scratchpad"],
				"memory_prompts": [chat_history_for_memory_prompts],
			},
			# The following **kwargs are additional keyword arguments passed to the agent executor (Chain)
			verbose=True,
			memory = self.memory,
			max_iterations=max_iterations,
			return_intermediate_steps=True,
		)
  
		# Step 3: Run the agent
		inputs = {'input': self.question} # the input_key is "input" in get_memory()
		response = agent(inputs)
		print(f"++++++ response: {response}")
  
		# serialize intermediate_steps
		# intermediate_steps_serializable = self.serialize_intermediate_steps(response.get("intermediate_steps", []))
		intermediate_steps_serializable = [self.serialize_agent_action(step) for step in response.get("intermediate_steps", [])]
		print(f"++++++ intermediate_steps_serializable: {intermediate_steps_serializable}")
  
	
		metadata = {
			"text2text_model": self.env["text2text_model"],
			"temperature": self.temperature,
			"chat_history_window": self.chat_history_window,
			"reasoning_acting_steps": intermediate_steps_serializable,
		}
  
		if self.env["files"]:
			metadata["files"] = self.env["files"]
   
		self.chat_history.add_metadata(metadata)

		final_response_with_metadata = {
			"sessionId": self.session_id,
			"type": "text",
			"content": response["output"],
			"metadata": metadata,
		}
	
		return final_response_with_metadata

 	# +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	def run(self, agent_id="awsOps"):
		self.agent_id = agent_id
		self.show_reasoning_acting_steps = self.env.get("show_reasoning_acting_steps", True)
  
		# self.text2text_model = "Bedrock"
  
		# # environment can only be string
		# self.files = self.env.get("files", [])
		# os.environ["files"] = json.dumps(self.files)
  
		if agent_id == "default_agent":
			return self.default_agent()
		elif agent_id == "default_agent_without_routing":
			return self.default_agent_with_tools() 
		elif agent_id == "Chatbot":
			return self.chatbot() # for debug's purpose
		else:
			return self.default_agent()
		