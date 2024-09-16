#!/bin/bash
# Usage: ./code_layout.sh [REPO_DIR] [OUTPUT_FILE] [FILE_EXTENSIONS]
# Description: Combine all code files in a repository into a single file, extracting functions, skipping node_modules
# Example: ./code_layout.sh ~/projects/my_project combined_functions.txt py js html css java cpp h cs

# Directory of the repository (default to current directory if not specified)
REPO_DIR="${1:-.}"

# Output file (default to combined_functions.txt if not specified)
OUTPUT_FILE="${2:-combined_functions.txt}"

# List of file extensions to include (default to a predefined list if not specified)
FILE_EXTENSIONS=("${@:3}")
if [ ${#FILE_EXTENSIONS[@]} -eq 0 ]; then
    FILE_EXTENSIONS=("py" "js" "java" "cpp" "ts")
fi

# Empty the output file if it exists
> "$OUTPUT_FILE"

# Function to extract functions and combine files
combine_files() {
    local dir="$1"
    local find_command="find \"$dir\" -type f \\( -name \"*.${FILE_EXTENSIONS[0]}\""
    for ext in "${FILE_EXTENSIONS[@]:1}"; do
        find_command+=" -o -name \"*.$ext\""
    done
    find_command+=" \\) -not -path \"*/node_modules/*\" -print0"

    eval $find_command | while IFS= read -r -d '' file; do
        echo "// File: $file" >> "$OUTPUT_FILE"
        # # Use grep with Perl-compatible regex to extract functions
        # grep -Pzo "(?:export\s+)?(?:async\s+)?function\s+\w+\s*\([^)]*\)(?:\s*:\s*[^{]*?)?\s*{(?:[^{}]*|\{(?:[^{}]*|\{[^{}]*\})*\})*}" "$file" | \
        # # Replace null bytes with newlines
        # sed -e 's/\x0/\n\n/g' >> "$OUTPUT_FILE"
        # echo -e "\n\n" >> "$OUTPUT_FILE"

        # Use perl to extract functions in consideration of performance, since above grep command may be slow for large files with warnings: grep: exceeded PCRE's backtracking limit
        perl -0777 -ne 'print "$&\n\n" while /((?:export\s+)?(?:async\s+)?function\s+\w+\s*\([^)]*\)(?:\s*:\s*[^{]*?)?\s*{(?:[^{}]*|\{(?:[^{}]*|\{[^{}]*\})*\})*})/gs' "$file" >> "$OUTPUT_FILE"
        echo -e "\n" >> "$OUTPUT_FILE"
    done
}

# Combine the files
combine_files "$REPO_DIR"

echo "All functions have been extracted and combined into $OUTPUT_FILE"