#!/bin/bash

# Check if a parameter is provided; if not, default to 0
if [ $# -eq 0 ]; then
  demo_number=0
elif [ "$1" = "0" ] || [ "$1" = "1" ]; then
  demo_number=$1
else
  echo -e "\033[36mInvalid argument. Please use 0 or 1.\033[0m"
  exit 1
fi

# Step 1: Ensure we are on the dev branch; if not, switch to dev branch
current_branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$current_branch" != "dev" ]; then
  echo -e "\033[36mCurrent branch is not 'dev', switching to 'dev' branch...\033[0m"
  git checkout dev
fi

# Step 2: Copy files from src/demo_$demo_number to src/, overwriting existing files
# echo -e "\033[36mCopying files from src/demo_$demo_number to src/ and overwriting existing files...\033[0m"
echo -e "\033[36mI am currently editing several code files....\033[0m"
cp -r src/demo_"$demo_number"/* src/

# If you need to copy hidden files, uncomment the following lines
# shopt -s dotglob
# cp -r src/demo_"$demo_number"/* src/
# shopt -u dotglob

# Step 3: Add changes, commit with a random message, and push to remote
echo -e "\033[36mAdding changes to Git staging area...\033[0m"
git add src/

# Generate a commit message using 'demo', current date, and a random number
current_date=$(date '+%Y-%m-%d')

# Generate a random number between 0 and 1000, RANDOM is between 0 and 32767
random_number=$(( RANDOM % 100 + 1 ))  # 生成 1 到 100 之间的数

commit_message="demo $current_date $random_number"

echo -e "\033[36mUsing commit message: $commit_message\033[0m"
git commit -m "$commit_message"

echo -e "\033[36mPushing changes to remote 'dev' branch...\033[0m"
git push origin dev

echo -e "\033[32mOperation completed!\033[0m"
