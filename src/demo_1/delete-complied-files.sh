#!/bin/bash

# 定义要跳过的目录列表
EXCLUDE_DIRS=(
"./node_modules"
"./react-app/dist"
"./cdk"
)

# 构建排除目录的find参数
EXCLUDE_FIND_PARAMS=""
for dir in "${EXCLUDE_DIRS[@]}"; do
    EXCLUDE_FIND_PARAMS="$EXCLUDE_FIND_PARAMS ! -path \"$dir/*\""
done

# 遍历当前目录下的所有 .js 和 .d.ts 文件，但跳过指定的目录
for file in $(eval find . -type f \( -name "*.js" -o -name "*.d.ts" \) $EXCLUDE_FIND_PARAMS); do
    # 基于当前文件，获得相应的 .ts 文件路径
    ts_file="${file%.*}.ts"

    # 检查 .ts 文件是否存在
    if [ -f "$ts_file" ]; then
        echo "Deleting $file because $ts_file exists."
        rm -f "$file"
    else
        echo "Skipping $file because $ts_file does not exist."
    fi
done
