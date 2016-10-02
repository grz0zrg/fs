/* jslint browser: true */
/* jshint globalstrict: false */

    /***********************************************************
        Fields.
    ************************************************************/

var _audio_context = new window.AudioContext(),
    
    _sample_rate = _audio_context.sampleRate,
    
    _volume = 0.01,

    // wavetable
    _wavetable_size = 4096,
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

    _note_time = 1 / _fps,
    _note_time_samples = Math.round(_note_time * _sample_rate),

    _curr_sample = 0,
    _lerp_t = 0,
    
    _notes_processing_pool = [],
    _notes_worker_pool = [],
    
    _curr_notes_data = [],
    _pending_notes_data = [],
    _next_notes_data = [],
    
    _data_switch = false,
    
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
        phase_step = 0.0,
        octave_length = n / octaves;

    _oscillators = [];

    for (y = n; y >= 0; y -= 1) {
        frequency = base_frequency * Math.pow(2, y / octave_length);
        phase_step = frequency / _audio_context.sampleRate * _wavetable_size;

        var osc = {
            freq: frequency,

            phase_index: Math.random() * _wavetable_size, 
            phase_step: phase_step
        };

        _oscillators.push(osc);
    }
};

var _notesWorkerAvailable = function () {
    var worker_obj,
        
        i = 0;
    
    for (i = 0; i < _notes_worker_pool.length; i += 1) {
        worker_obj = _notes_worker_pool[i];
        
        if (!worker_obj.available) {
            return false;
        }
    }
    
    return true;
};

var _addNotesWorker = function () {
    var worker_obj;
    
    _notes_worker_pool.push({
            worker: new Worker("js/worker/notes_buffer.js"),
            available: true
        });
    
    worker_obj = _notes_worker_pool[_notes_worker_pool.length - 1];
    
    worker_obj.worker.addEventListener('message', function (w) {
            var i = 0,
                
                _notes_processing;
        
            _pending_notes_data.push(new Float32Array(w.data.d));

            // the worker is now available, make it process what is pending
            if (_notes_processing_pool.length > 0) {
                _notes_processing = _notes_processing_pool.pop();
                
                worker_obj.worker.postMessage({
                        score_height: _canvas_height,
                        data: _notes_processing.arr.buffer,
                        prev_data: _notes_processing.prev_arr.buffer
                    }, [_notes_processing.arr.buffer, _notes_processing.prev_arr.buffer]);
            } else {
                worker_obj.available = true;
                
                // all workers are done? make the data available to play
                if (_notesWorkerAvailable()) {
                    _next_notes_data = _pending_notes_data;
                    
                    _pending_notes_data = [];
                    
                    _data_switch = true;
                }
            }
        }, false);
};

var _submitNotesProcessing = function (arr, prev_arr) {    
    var worker_obj,
        
        i = 0;
    
    for (i = 0; i < _notes_worker_pool.length; i += 1) {
        worker_obj = _notes_worker_pool[i];
        
        if (worker_obj.available) {
            worker_obj.worker.postMessage({
                    score_height: _canvas_height,
                    data: arr.buffer,
                    prev_data: prev_arr.buffer
                }, [arr.buffer, prev_arr.buffer]);
            
            worker_obj.available = false;
            
            return;
        }
    }
    
    // no workers available, add it to the processing pool
    _notes_processing_pool.push({
        arr: arr,
        prev_arr: prev_arr
    });
};

var _audioProcess = function (audio_processing_event) {
    var output_buffer = audio_processing_event.outputBuffer,

        output_data_l = output_buffer.getChannelData(0),
        output_data_r = output_buffer.getChannelData(1),

        output_data_length = output_data_l.length,

        output_l = 0, output_r = 0,

        wavetable = _wavetable,

        notes_len = _curr_notes_data.length,
        note_buffer,
        note_buffer_len,

        wavetable_size_m1 = _wavetable_size - 1,

        osc,

        lerp_t_step = 1 / _note_time_samples,

        sample,

        s, j, i;

    for (sample = 0; sample < output_data_length; sample += 1) {
        output_l = 0.0;
        output_r = 0.0;

        for (i = 0; i < notes_len; i += 1) {
            note_buffer = _curr_notes_data[i];
            note_buffer_len = note_buffer.length;
            
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
        }

        output_data_l[sample] = output_l;
        output_data_r[sample] = output_r;

        _lerp_t += lerp_t_step;

        _curr_sample += 1;

        if (_curr_sample >= _note_time_samples) {
            _lerp_t = 0;

            _curr_sample = 0;
            
            if (_data_switch) {
                _curr_notes_data = _next_notes_data;
                
                _data_switch = false;
            }
        }
    }
};

/***********************************************************
    Init.
************************************************************/

_mst_gain_node = _createGainNode(_volume, _audio_context.destination);

_generateOscillatorSet(_canvas_height, 16.34, 10);

_script_node = _audio_context.createScriptProcessor(0, 0, 2);
_script_node.onaudioprocess = _audioProcess;

_script_node.connect(_mst_gain_node);

// workaround, webkit bug
window._fs_sn = _script_node;
