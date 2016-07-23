/* jslint browser: true */
/* jshint globalstrict: false */
/* global CodeMirror, performance*/

/*#include wui/wui.min.js*/

/*#include codemirror/codemirror.js*/
/*#include codemirror/addon/search/searchcursor.js*/
/*#include codemirror/addon/search/match-highlighter.js*/
/*#include codemirror/addon/edit/closebrackets.js*/
/*#include codemirror/addon/edit/matchbrackets.js*/
/*#include codemirror/addon/scroll/simplescrollbars.js*/
/*#include codemirror/addon/selection/active-line.js*/
/*#include codemirror_glsl.js*/

var FragmentSynth = new (function() {
    "use strict";
    
    /***********************************************************
        Global.
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
                                    window.webkitRequestAnimationFrame || window.msRequestAnimationFrame;
    window.cancelAnimationFrame = window.cancelAnimationFrame || window.mozCancelAnimationFrame;
    
    if (!window.AudioContext) {
        _fail("Your browser do not support the Web Audio API, needed to run this app.");
        
        return;
    }
    
    /***********************************************************
        Fields.
    ************************************************************/
    
    var _audio_context = new window.AudioContext(),
    
        _canvas,
        
        _canvas_width  = window.innerWidth,
        _canvas_height = Math.round(window.innerHeight / 2),
        
        _render_width = _canvas_width,
        _render_height = _canvas_height,

        _code_editor,
        
        _compile_timer,
        
        _mx,
        _my,
        
        _fps = 60,
        
        _volume = 0.05,
        
        _play_position = 0.5725,
        
        _raf,
        
        _gl,
        
        _play_position_element = document.getElementById("play_position_marker"),
        
        _fail_element = document.getElementById("fail"),
    
        _webgl_opts = {
                preserveDrawingBuffer: true
            },
        
        _program,
        
        _sample_rate = _audio_context.sampleRate,
    
        _wavetable_size = 32768,
        
        _wavetable = (function (wsize) {
                var wavetable = new Float32Array(wsize),

                    wave_phase = 0,
                    wave_phase_step = 2 * Math.PI / wsize,

                    s = 0;

                for (s = 0; s < wsize; s += 1) {
                    wavetable[s] = Math.sin(wave_phase);

                    wave_phase += wave_phase_step;
                }

                return wavetable;
            })(_wavetable_size),
        
        _oscillators,
        
        _note_buffer = new Float32Array(_canvas_height * 5),
        
        _data = new Uint8Array(_canvas_height * 4),
        
        _prev_data = _data,
        
        _time = performance.now(),
        
        _note_time = 1 / _fps,
        _note_time_samples = Math.round(_note_time * _sample_rate),
        
        _curr_sample = 0,
        _lerp_t = 0,
        _swap_buffer = true,
        
        _mst_gain_node,
        _script_node;
    
    /***********************************************************
        Functions.
    ************************************************************/

    var _createGainNode = function (gain, dst) {
        var gain_node = _audio_context.createGain();
        gain_node.gain.value = gain;
        gain_node.connect(dst);

        return gain_node;
    };
 
    var _generateOscillatorSet = function (n, base_frequency, octaves) {
        var y = 0,
            frequency = 0.0,
            octave_length = n / octaves;
        
        _oscillators = [];

        for (y = n; y >= 0; y -= 1) {
            frequency = base_frequency * Math.pow(2, y / octave_length);

            var osc = {
                freq: frequency,
                
                phase_index: Math.random() * _wavetable_size, 
                phase_step: frequency / _audio_context.sampleRate * _wavetable_size
            };
            
            _oscillators.push(osc);
        }
    };
    
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
    
    var _computeNoteBuffer = function () {
        for (i = 0; i < _note_buffer.length; i += 1) {
            _note_buffer[i] = 0;
        }
        
        var note_buffer = _note_buffer,
            pvl = 0, pvr = 0, pr, pg, r, g,
            inv_full_brightness = 1 / 255.0,

            dlen = _data.length,
            y = _canvas_height - 1, i,
            volume_l, volume_r,
            index = 0;

        for (i = 0; i < dlen; i += 4) {
            pr = _prev_data[i];
            pg = _prev_data[i + 1];
            
            r = _data[i];
            g = _data[i + 1];

            if (r > 0 || g > 0) {
                volume_l = r * inv_full_brightness;
                volume_r = g * inv_full_brightness;
                
                pvl = pr * inv_full_brightness;
                pvr = pg * inv_full_brightness;

                note_buffer[index] = y;
                note_buffer[index + 1] = pvl;
                note_buffer[index + 2] = pvr;
                note_buffer[index + 3] = volume_l - pvl;
                note_buffer[index + 4] = volume_r - pvr;
            } else {
                if (pr > 0 || pg > 0) {
                    pvl = pr * inv_full_brightness;
                    pvr = pg * inv_full_brightness;

                    note_buffer[index] = y;
                    note_buffer[index + 1] = pvl;
                    note_buffer[index + 2] = pvr;
                    note_buffer[index + 3] = -pvl;
                    note_buffer[index + 4] = -pvr;
                }
            }

            y -= 1;

            index += 5;
        }
        
        _prev_data = _data;
        
        _swap_buffer = true;
    };
    
    var _audioProcess = function (audio_processing_event) {
        var output_buffer = audio_processing_event.outputBuffer,
            
            output_data_l = output_buffer.getChannelData(0),
            output_data_r = output_buffer.getChannelData(1),
            
            output_l = 0, output_r = 0,
            
            wavetable = _wavetable,
            
            note_buffer = _note_buffer,
            note_buffer_len = note_buffer.length,
            
            wavetable_size_m1 = _wavetable_size - 1,
            
            osc,
            
            lerp_t_step = 1 / _note_time_samples,
            
            sample,
            
            s, j;
        
        for (sample = 0; sample < output_data_l.length; sample += 1) {
            output_l = 0.0;
            output_r = 0.0;

            for (j = 0; j < note_buffer_len; j += 5) {
                var osc_index         = note_buffer[j],
                    previous_volume_l = note_buffer[j + 1],
                    previous_volume_r = note_buffer[j + 2],
                    diff_volume_l     = note_buffer[j + 3],
                    diff_volume_r     = note_buffer[j + 4];

                osc = _oscillators[osc_index];

                s = wavetable[osc.phase_index & wavetable_size_m1];

                output_l += (previous_volume_l + diff_volume_l * _lerp_t) * s;
                output_r += (previous_volume_r + diff_volume_r * _lerp_t) * s;
                    
                osc.phase_index += osc.phase_step;
                
                if (osc.phase_index >= _wavetable_size) {
                    osc.phase_index -= _wavetable_size;
                }
            }
            
            output_data_l[sample] = output_l;
            output_data_r[sample] = output_r;
            
            _lerp_t += lerp_t_step;
            
            _curr_sample += 1;

            if (_curr_sample >= _note_time_samples) {
                _lerp_t = 0;

                _curr_sample = 0;

                _computeNoteBuffer();
            }
        }
    };
    
    var _compile = function () {
        _gl.deleteProgram(_program);
        
        var frag = _createShader(_gl.FRAGMENT_SHADER, _code_editor.getValue());

        _program = _createAndLinkProgram(
                _createShader(_gl.VERTEX_SHADER, document.getElementById("vertex-shader").text),
                frag
            );
        
        if (_program) {
            _mst_gain_node.gain.value = _volume;
            
            _fail_element.innerHTML = "";
            
            window.cancelAnimationFrame(_raf);
            _raf = window.requestAnimationFrame(_frame);
            
            _gl.useProgram(_program);

            _gl.uniform2f(_gl.getUniformLocation(_program, "resolution"), _canvas.width, _canvas.height);

            var position = _gl.getAttribLocation(_program, "position");
            _gl.enableVertexAttribArray(position);
            _gl.vertexAttribPointer(position, 2, _gl.FLOAT, false, 0, 0);
        } else {
            window.cancelAnimationFrame(_raf);
            
            _mst_gain_node.gain.value = 0.0;
        }
    };
    
    var _frame = function (raf_time) { 
        _gl.useProgram(_program);
        _gl.uniform1f(_gl.getUniformLocation(_program, "globalTime"), (raf_time - _time) / 1000);
        _gl.uniform2f(_gl.getUniformLocation(_program, "iMouse"), _mx, _my);

        _gl.drawArrays(_gl.TRIANGLE_STRIP, 0, 4);

        if (_swap_buffer) {
            _gl.readPixels((_canvas_width - 1) * _play_position, 0, 1, _canvas_height, _gl.RGBA, _gl.UNSIGNED_BYTE, _data);

            _swap_buffer = false;
        }

        _raf = window.requestAnimationFrame(_frame);
    };
    
    var _setPlayPosition = function (percent) {
        _play_position = percent;
        
        _play_position_element.style.left = _canvas_width * _play_position + "px";
    };

    /***********************************************************
        Init.
    ************************************************************/
    
    document.addEventListener('mousemove', function (e) {
            var e = e || window.event;

            _mx = e.pageX / window.innerWidth;
            _my = e.pageY / window.innerHeight;
	   });
    
    _mst_gain_node = _createGainNode(_volume, _audio_context.destination);
    
    _generateOscillatorSet(_canvas_height, 16.34, 10);
    
    _script_node = _audio_context.createScriptProcessor(0, 0, 2);
    _script_node.onaudioprocess = _audioProcess;
    
    _script_node.connect(_mst_gain_node);
    
    // workaround, webkit bug
    window._fs_sn = _script_node;

    _canvas = document.createElement("canvas");

    _canvas.width  = _render_width;
    _canvas.height = _render_height;

    _canvas.style.width  = _canvas_width  + 'px';
    _canvas.style.height = _canvas_height + 'px';
    
    document.getElementById("canvas").appendChild(_canvas);

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
    
    _setPlayPosition(_play_position);
    
    WUI_RangeSlider.create("mst_slider", {
        width: 180,
        height: 8,
            
        min: 0,
        max: 1,
            
        step: 0.01,
        
        default_value: _volume,
            
        title: "Gain",
        
        title_min_width: 80,
        value_min_width: 48,
            
        on_change: function (value) {
            _volume = value;
            
            _mst_gain_node.gain.value = value;
        }
    });
    
    WUI_RangeSlider.create("play_position_slider", {
        width: 180,
        height: 8,
            
        min: 0,
        max: 100,
            
        step: 0.25,
        
        default_value: _play_position * 100,
            
        title: "Position (%)",
        
        title_min_width: 80,
        value_min_width: 48,
            
        on_change: function (value) {
            _setPlayPosition(value / 100);
        }
    });
    
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
        _canvas_width  = window.innerWidth;
        _canvas_height = Math.round(window.innerHeight / 2);
        
        _generateOscillatorSet(_canvas_height, 16.34, 10);
        
        _note_buffer = new Float32Array(_canvas_height * 5);
        _data = new Uint8Array(_canvas_height * 4);
        _prev_data = _data;
        
        _setPlayPosition(_play_position);
    });
})();
