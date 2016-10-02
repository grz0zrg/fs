# Fragment - GLSL driven spectral synthesizer
=====

This is a web synthesizer which is driven by visuals generated by a fragment program written in GLSL, the first implementation (v1.0) was a quick proof of concept, i am working on the second version which will feature some powerful things enabling people to create, share their own synthesizer, collaborate and compose.

You can read [this article](http://www.garzul.tonsite.biz/wordpress/2016/07/23/fragment-synthesizer-glsl-powered-html5-spectral-synthesizer/) for an explanation of the idea behind this synthesizer and for an in-depth look at the first implementation.

You can test the first version [here](https://grz0zrg.github.io/fs/)

This make use of the [WUI](https://github.com/grz0zrg/wui), [CodeMirror](https://codemirror.net/) library

####Building

This was built with a not yet released live build system (just a simple pre-processor looking for modifications and which executes programs when the build is finished) written with the Anubis language but the project can be built out of the box easily if you find a way to run a custom pre-processor on **js/app_fs.js** and **css/app_fs.css** files which look for the /*include filename*/ directive and include the file **filename** content.

####Development

Check ***app_fs.js*** for the entry point file (all other files are included in this file by a pre-processor).

The code is organized in a very specific way, an organization i found out and stayed with after doing multiple projects, everything is contained in a single file and all the application code is into a self-invoking function called ***FragmentSynth***, there is no app. code outside this function, since it would be a bit crazy to do all the work in a single file, a pre-processor is needed to allow different files to be included and used, to help organize the code there is different code sections for each files which are explained below.

For the entry point file, code sections are:

* ***Globals.*** : Code which override certain API behaviors.
* ***App. Includes.*** : Files needed by the application are included here.

For all the other files and the entry point file, code sections are:

* ***Fields.*** : All variables used by the file are initialized here in one go (var _first, _second etc...) and start with an underscore, an underscore is also used between each words.
* ***Functions.*** : All functions used by the file are initialized here and start with an underscore, functions name are in _camelCase.
* ***Init.*** : Initialization code, the code which will be executed when the app start.

There is an anonymous section at the start of the entry point file which is used to include all external libraries needed by the app.

These sections can be easily parsed to permit quick jump to specific code sections within a text editor.

Application variables start with an underscore, local variables does not start with an underscore.

***Note:*** My pre-processor allow the include directive only into the entry point file because it would be completely chaotic to allow that into other files...