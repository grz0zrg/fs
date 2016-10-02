/* jslint browser: true */
/* jshint globalstrict: false */

    /***********************************************************
        Fields.
    ************************************************************/

var _load_indicator_element = document.getElementById("fs_load_indicator"),
    
    _css_fs_hide = "fs-hide";

    /***********************************************************
        Functions.
    ************************************************************/

var _showLoadIndicator = function () {
    _load_indicator_element.classList.remove(_css_fs_hide);
};

var _hideLoadIndicator = function () {
    _load_indicator_element.classList.add(_css_fs_hide);
};

var _domCreatePlayPositionMarker = function (hook_element) {
    var play_position_marker_div = document.createElement("div"),
        decoration_div = document.createElement("div");
    
    play_position_marker_div.className = "play-position-marker";
    decoration_div.className = "play-position-triangle";
    
    play_position_marker_div.appendChild(decoration_div);
    
    hook_element.parentElement.insertBefore(play_position_marker_div, hook_element);
    
    return play_position_marker_div;
};