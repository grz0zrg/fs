/* jslint browser: true */
/* jshint globalstrict: false */
/* global CodeMirror, performance*/

// WUI - https://github.com/grz0zrg/wui
/*#include wui/wui.js*/

// CodeMirror - https://codemirror.net/
/*#include codemirror/codemirror.js*/
/*#include codemirror/addon/search/searchcursor.js*/
/*#include codemirror/addon/search/match-highlighter.js*/
/*#include codemirror/addon/edit/closebrackets.js*/
/*#include codemirror/addon/edit/matchbrackets.js*/
/*#include codemirror/addon/scroll/simplescrollbars.js*/
/*#include codemirror/addon/selection/active-line.js*/
/*#include codemirror_glsl.js*/

var FragmentSynth = new (function () {
    "use strict";
    
    /***********************************************************
        Globals.
    ************************************************************/
    
    window.performance = window.performance || {};
    performance.now = (function() {
      return performance.now       ||
             performance.mozNow    ||
             performance.msNow     ||
             performance.oNow      ||
             performance.webkitNow ||
             function() { return new Date().getTime(); };
    })();
    
    window.AudioContext = window.AudioContext || window.webkitAudioContext || false;
    
    window.requestAnimationFrame =  window.requestAnimationFrame || window.mozRequestAnimationFrame ||
                                    window.webkitRequestAnimationFrame || window.msRequestAnimationFrame
    window.cancelAnimationFrame = window.cancelAnimationFrame || window.mozCancelAnimationFrame;
    
    if (!window.AudioContext) {
        _fail("Your browser do not support the Web Audio API, needed to run this app.");
        
        return;
    }
    
    /***********************************************************
        Fields.
    ************************************************************/
    
    var _canvas_container = document.getElementById("canvas_container"),
        _canvas,
        
        _canvas_width  = window.innerWidth,
        _canvas_height = Math.round(window.innerHeight / 2),
        
        _canvas_width_m1 = _canvas_width - 1,
        _canvas_height_mul4 = _canvas_height * 4,
        
        _render_width = _canvas_width,
        _render_height = _canvas_height,

        _code_editor,
        
        _compile_timer,
        
        _mx,
        _my,
        
        _fps = 60,

        _raf,
        
        _gl,
        
        _play_position_markers = [],
        
        _fail_element = document.getElementById("fail"),
    
        _webgl_opts = {
                preserveDrawingBuffer: true
            },
        
        _program,
        
        _time = performance.now();
    
    
    /***********************************************************
        App. Includes.
    ************************************************************/
    
    /*#include widgets.js*/
    /*#include audio.js*/

    /***********************************************************
        Functions.
    ************************************************************/
    
    var _fail = function (message) {
        _fail_element.innerHTML = message;
    };
    
    var _buildScreenAlignedQuad = function() {
        _gl.bindBuffer(_gl.ARRAY_BUFFER, _gl.createBuffer());
        _gl.bufferData(_gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), _gl.STATIC_DRAW);

        var position = _gl.getAttribLocation(_program, "position");
        _gl.enableVertexAttribArray(position);
        _gl.vertexAttribPointer(position, 2, _gl.FLOAT, false, 0, 0);
    };
    
    var _createAndLinkProgram = function (vertex_shader, fragment_shader) {
        if (!vertex_shader || !fragment_shader) {
            return;
        }

        var prog = _gl.createProgram();
        
        _gl.attachShader(prog, vertex_shader);
        _gl.attachShader(prog, fragment_shader);
        
        _gl.linkProgram(prog);
        
        if (!_gl.getProgramParameter(prog, _gl.LINK_STATUS)) {
            _fail("Failed to link program: " + _gl.getProgramInfoLog(prog));
        }
        
        _gl.deleteShader(vertex_shader);
        _gl.deleteShader(fragment_shader);
        
        return prog;
    };

    var _createShader = function (shader_type, shader_code) {
        var shader = _gl.createShader(shader_type);
        
        _gl.shaderSource(shader, shader_code);
        _gl.compileShader(shader);
        
        if (!_gl.getShaderParameter(shader, _gl.COMPILE_STATUS)) {
            _fail("Failed to compile shader: " + _gl.getShaderInfoLog(shader));
            
            _gl.deleteShader(shader);
            
            shader = false;
        }
        
        return shader;
    };
    
    var _compile = function () {
        _showLoadIndicator();
        
        _gl.deleteProgram(_program);
        
        var frag = _createShader(_gl.FRAGMENT_SHADER, _code_editor.getValue());

        _program = _createAndLinkProgram(
                _createShader(_gl.VERTEX_SHADER, document.getElementById("vertex-shader").text),
                frag
            );
        
        if (_program) {
            if (_mst_gain_node) {
                _mst_gain_node.gain.value = _volume;
            }
            
            _fail_element.innerHTML = "";
            
            _gl.useProgram(_program);

            _gl.uniform2f(_gl.getUniformLocation(_program, "resolution"), _canvas.width, _canvas.height);

            var position = _gl.getAttribLocation(_program, "position");
            _gl.enableVertexAttribArray(position);
            _gl.vertexAttribPointer(position, 2, _gl.FLOAT, false, 0, 0);
            
            window.cancelAnimationFrame(_raf);
            _raf = window.requestAnimationFrame(_frame);
        } else {
            window.cancelAnimationFrame(_raf);
            
            _mst_gain_node.gain.value = 0.0;
        }
        
        _hideLoadIndicator();
    };
    
    var _frame = function (raf_time) {
        var i = 0,
            
            play_position_marker,
            play_position_marker_x = 0,
            
            buffer;
        
        _gl.useProgram(_program);
        _gl.uniform1f(_gl.getUniformLocation(_program, "globalTime"), (/*raf_time*/performance.now() - _time) / 1000);
        _gl.uniform2f(_gl.getUniformLocation(_program, "iMouse"), _mx, _my);

        _gl.drawArrays(_gl.TRIANGLE_STRIP, 0, 4);
        
        if (_notesWorkerAvailable()) {
            for (i = 0; i < _play_position_markers.length; i += 1) {
                play_position_marker = _play_position_markers[i];
                play_position_marker_x = play_position_marker.position;

                
                play_position_marker.prev_data = new Uint8Array(play_position_marker.data);
                play_position_marker.data = new Uint8Array(_canvas_height_mul4);

                _gl.readPixels(play_position_marker_x, 0, 1, _canvas_height, _gl.RGBA, _gl.UNSIGNED_BYTE, play_position_marker.data);
                
                // make a copy of the buffer because workers will take it
                buffer = new Uint8Array(play_position_marker.data);
                
                _submitNotesProcessing(play_position_marker.data, play_position_marker.prev_data);
                
                play_position_marker.data = buffer;
            }
        }
        
        _raf = window.requestAnimationFrame(_frame);
    };
    
    var _setPlayPosition = function (play_position_marker_id, percent) {
        var play_position_marker = _play_position_markers[play_position_marker_id],
            
            x = _canvas_width_m1 * percent;
        
        play_position_marker.position_percent = percent;
        play_position_marker.position = x;

        play_position_marker.element.style.left = x + "px";
    };
    
    var _addPlayPositionMarker = function (percent) {
        var play_position_marker_element = _domCreatePlayPositionMarker(_canvas),
            play_position_marker_id = 0;
        
        _play_position_markers.push({
                element: play_position_marker_element,
                data: new Uint8Array(_canvas_height_mul4),
                prev_data: new Uint8Array(_canvas_height_mul4),
                position_percent: percent / 100, // play position (percent)
                position: _canvas_width_m1 * (percent / 100)
            });
        
        play_position_marker_id = _play_position_markers.length - 1;
        
        _setPlayPosition(play_position_marker_id, _play_position_markers[play_position_marker_id].position_percent);

        WUI.draggable(play_position_marker_element, true, function (element, x) {
                _setPlayPosition(play_position_marker_id, x / window.innerWidth);
            });
        WUI.lockDraggable(play_position_marker_element, 'y');
    };

    /***********************************************************
        Init.
    ************************************************************/
    
    document.addEventListener('mousemove', function (e) {
            var e = e || window.event;

            _mx = e.pageX / window.innerWidth;
            _my = e.pageY / window.innerHeight;
	   });

    _canvas = document.createElement("canvas");

    _canvas.width  = _render_width;
    _canvas.height = _render_height;

    _canvas.style.width  = _canvas_width  + 'px';
    _canvas.style.height = _canvas_height + 'px';
    
    _canvas_container.appendChild(_canvas);

    _gl = _canvas.getContext("webgl", _webgl_opts) || _canvas.getContext("experimental-webgl", _webgl_opts);
    
    if (!_gl) {
        _fail("Your browser do not support the WebGL API, needed to run this app.");
        
        document.body.removeChild(_canvas);
        
        return;
    }
    
    _program = _createAndLinkProgram(
            _createShader(_gl.VERTEX_SHADER,   document.getElementById("vertex-shader").text),
            _createShader(_gl.FRAGMENT_SHADER, document.getElementById("fragment-shader").text)
        );

    _gl.viewport(0, 0, _canvas.width, _canvas.height);

    _gl.useProgram(_program);
    
    _buildScreenAlignedQuad();
    
    _gl.uniform1f(_gl.getUniformLocation(_program, "globalTime"), _time);
    _gl.uniform2f(_gl.getUniformLocation(_program, "resolution"), _canvas.width, _canvas.height);

    WUI_RangeSlider.create("mst_slider", {
        width: 180,
        height: 8,
            
        min: 0,
        max: 1,
            
        step: 0.005,
        
        default_value: _volume,
            
        title: "Gain",
        
        title_min_width: 80,
        value_min_width: 48,
            
        on_change: function (value) {
            _volume = value;
            
            _mst_gain_node.gain.value = value;
        }
    });
    
    // setup at least one play position marker with one worker
    _addPlayPositionMarker(50);
    //_addPlayPositionMarker(75);
    _addNotesWorker();
    _addNotesWorker();
    
    WUI_ToolBar.create("toolbar", {
            allow_groups_minimize: false
        },
        {  
            toolbar: [
                {
                    text: "convert from Shadertoy",
                    type: "buton",
                    
                    toggle_state: false,

                    on_click: function () {
                        var input_code  = _code_editor.getValue(),
                            output_code = input_code,
                            
                            header = "precision mediump float;\n\nuniform float globalTime;\nuniform vec2 iMouse;\nuniform vec2 resolution;\n\n";

                        output_code = output_code.replace(/iGlobalTime/g, "globalTime");
                        output_code = output_code.replace(/iResolution/g, "resolution");
                        output_code = output_code.replace(/void\s+mainImage\s*\(\s*out\s+vec4\s+fragColor\s*,\s*in\s+vec2\s+fragCoord\s*\)/, "void main ()");
                        output_code = output_code.replace(/fragCoord/g, "gl_FragCoord");
                        output_code = output_code.replace(/fragColor/g, "gl_FragColor");

                        _code_editor.setValue(header + output_code);
                        
                        _compile();
                    }
                },
                {
                    text: "play/pause",
                    type: "button",
                                        
                    toggle_state: false,
                    on_click: function () {
                        _startStopAudio();
                    }
            }
            ]
        });

    _code_editor = new CodeMirror(document.getElementById("code"), {
        value: document.getElementById("fragment-shader").text,
        theme: "ambiance",
        matchBrackets: true,
        highlightSelectionMatches: { },
        autoCloseBrackets: true,
        lineNumbers: true,
        styleActiveLine: true,
        scrollbarStyle: "overlay",
        mode: "text/x-glsl"
    });
    
    CodeMirror.on(_code_editor, 'change', function () {
        clearTimeout(_compile_timer);
        _compile_timer = setTimeout(_compile, 500);
    });

    _raf = window.requestAnimationFrame(_frame);
    
    window.addEventListener("resize", function () {
        var play_position_marker,
        
            i = 0;
        
        _canvas_width  = window.innerWidth;
        _canvas_height = Math.round(window.innerHeight / 2);
        
        _canvas_width_m1 = _canvas_width - 1;
        _canvas_height_mul4 = _canvas_height * 4;

        _generateOscillatorSet(_canvas_height, 16.34, 10);
    });
})();
