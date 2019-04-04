# -*- coding: utf-8 -*-
#!/usr/bin/python
#
# pynut - Python build system built for the Fragment synthesizer and related web. stuff
#
# https://www.fsynth.com
#
# This is a simplified port of https://github.com/grz0zrg/nut without the live check & "build if changed" features, you can add thoses easily under Linux or similar systems with inotify tool
# This is like "nut", a quite generic build system, you can customize the include pattern, entry point name, you can also run a command on the bare output file depending on file extension to produce a production file (minification, optimizations etc.)
# Unlike "nut", this is not recursive altough a few lines of code could do that.
#
# Usage: build.py js/app_fs.js css/app_fs.css js/app_cm.js css/app_cm.css js/worker

import os
import re
import sys
import glob
import codecs

# this will include files when it encounter /*#include filepath*/ pattern
include_regex = re.compile("/\*#include (.*?)\*/")
# an entry point prefix,
entry_point_prefix = "app_"
# JavaScript prod. command to execute on JS output file (!target and !src are replaced with corresponding values)
js_prod_cmd = "uglifyjs --compress --mangle --screw-ie8 -o !target -- !src"
# CSS prod. command to execute on CSS output file (!target and !src are replaced with corresponding values)
css_prod_cmd = "csso !src !target"

work_directory = os.getcwd()

def insert(source_str, insert_str, pos):
    return source_str[:pos]+insert_str+source_str[pos:]

def get_line_content(filepath, workdir):
    content = ""
    current_line = 0

    with codecs.open(filename=filepath, mode='r', encoding='UTF-8') as f:
        if workdir:
            os.chdir(workdir)
        for line in f:
            inc = include_regex.search(line)
            if inc:
                inc_filename = inc.group(1)
                content += get_line_content(inc_filename, "")

                print("L" + str(current_line) + ": including '" + inc_filename)
            else:
                content += line
            current_line += 1
        f.close()
    return content

def build_file(filepath, build_subpath):
    print("processing '" + filepath + "'")

    head, tail = os.path.split(filepath)

    output_filename = "dist/" + build_subpath + tail.replace(entry_point_prefix, "")
    file_extension = os.path.splitext(filepath)[1]
    content = get_line_content(filepath, head)

    os.chdir(work_directory)

    print("producing '" + output_filename + "'...")
    f = codecs.open(filename=output_filename, mode='w', encoding='UTF-8')
    f.write(content)
    f.close()

    if file_extension == ".js":
        output_prodfile = insert(output_filename, ".min", len(output_filename) - len(file_extension))
        print("producing production file '" + output_prodfile + "'...")
        os.system(js_prod_cmd.replace("!target", output_prodfile).replace("!src", output_filename))
    elif file_extension == ".css":
        output_prodfile = insert(output_filename, ".min", len(output_filename) - len(file_extension))
        print("producing production file '" + output_prodfile + "'...")
        os.system(css_prod_cmd.replace("!target", output_prodfile).replace("!src", output_filename))

    print("build done for '" + filepath + "'")

def build_files(directory):
    head, tail = os.path.split(directory)
    for file in os.listdir(directory):
        build_file(directory + "/" + file, tail + "/")

if len(sys.argv) <= 1:
    print("Usage example: python build.py js/app_fs.js css/app_fs.css js/app_cm.js css/app_cm.css js/worker");
else:
    for arg in sys.argv[1:]:
        if os.path.isfile(arg): # single file
            if entry_point_prefix in arg: # check if it is an "entry point" file
                build_file(arg, "")
            else:
                print("'" + arg + "' is not a valid entry point, append '" + entry_point_prefix + "' to the filename")
        elif os.path.isdir(arg): # whole directory (such as a web. worker directory)
            build_files(arg)
        else:
            print("'" + arg + "' is not a valid directory or file. This will be ignored.")
