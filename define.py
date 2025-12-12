import json
import os
import re

# compile_commands.json 파일 경로
compile_commands_path = 'compile_commands.json'

# 현재 폴더의 상위 폴더 경로
parent_dir = os.path.abspath(os.path.join(os.getcwd(), '..'))

# 상위 폴더의 .vscode 폴더 경로
c_cpp_properties_path = os.path.join(parent_dir, '.vscode', 'c_cpp_properties.json')



# compile_commands.json 파일 읽기
with open(compile_commands_path, 'r') as f:
    compile_commands = json.load(f)

# defines 추출
defines = set()
define_pattern = re.compile(r'-D(\w+)')

for command in compile_commands:
    arguments = command.get('arguments', [])
    for arg in arguments:
        match = define_pattern.match(arg)
        if match:
            defines.add(match.group(1))

# c_cpp_properties.json 파일 읽기
with open(c_cpp_properties_path, 'r') as f:
    c_cpp_properties = json.load(f)

# defines 추가
for config in c_cpp_properties.get('configurations', []):
    config['defines'] = list(defines)

# c_cpp_properties.json 파일 쓰기
with open(c_cpp_properties_path, 'w') as f:
    json.dump(c_cpp_properties, f, indent=4)

print("c_cpp_properties.json 파일이 업데이트되었습니다.")