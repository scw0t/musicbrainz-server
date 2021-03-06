/*
   This file is part of MusicBrainz, the open internet music database.
   Copyright (C) 2012 MetaBrainz Foundation

   This program is free software; you can redistribute it and/or modify
   it under the terms of the GNU General Public License as published by
   the Free Software Foundation; either version 2 of the License, or
   (at your option) any later version.

   This program is distributed in the hope that it will be useful,
   but WITHOUT ANY WARRANTY; without even the implied warranty of
   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
   GNU General Public License for more details.

   You should have received a copy of the GNU General Public License
   along with this program; if not, write to the Free Software
   Foundation, Inc., 675 Mass Ave, Cambridge, MA 02139, USA.
*/

MB.RelationshipEditor = (function(RE) {

var UI = RE.UI = RE.UI || {};
var Util = RE.Util = RE.Util || {};
var $tracklist = $();


RE.releaseViewModel = {
    RE: RE,
    release: ko.observable(null),
    activeDialog: ko.observable(),

    checkboxes: (function() {
        var data = {
            recordingStrings: ko.observable([]),
            workStrings: ko.observable([]),
            recordingCount: ko.observable(0),
            workCount: ko.observable(0)
        };

        data.recordingMessage = ko.computed(function() {
            var strings = data.recordingStrings(),
                msg = strings[Math.min(strings.length - 1, data.recordingCount())];

            return msg ? "(" + msg + ")" : "";
        });

        data.workMessage = ko.computed(function() {
            var strings = data.workStrings(),
                msg = strings[Math.min(strings.length - 1, data.workCount())];

            return msg ? "(" + msg + ")" : "";
        });

        return data;
    }()),

    submissionLoading: ko.observable(false),
    submissionError: ko.observable(""),

    submit: function(data, event) {
        event.preventDefault();

        var self = this, data = {}, changed = [], addChanged,
            beforeUnload = window.onbeforeunload;

        this.submissionLoading(true);

        addChanged = function(relationship) {
            if (relationship.action.peek()) changed.push(relationship);
        };

        var release = this.release.peek();

        _.each(release.mediums, function(medium) {
            _.each(medium.tracks, function(track) {
                var recording = track.recording;

                _.each(recording.relationships.peek(), addChanged);

                _.each(recording.performanceRelationships.peek(), function(relationship) {
                    addChanged(relationship);
                    _.each(relationship.entity[1].peek().relationships.peek(), addChanged);
                });
            });
        });
        _.each(release.relationships.peek(), addChanged);
        _.each(release.releaseGroup.relationships.peek(), addChanged);

        if (changed.length == 0) {
            this.submissionLoading(false);
            this.submissionError(MB.text.NoChanges);
            return;
        }
        changed = _.uniq(changed);

        _.each(changed, function(relationship, num) {
            relationship.buildFields(num, data);
        });

        data["rel-editor.edit_note"] = _.str.trim($("#id-rel-editor\\.edit_note").val());
        data["rel-editor.as_auto_editor"] = $("#id-rel-editor\\.as_auto_editor").is(":checked") ? 1 : 0;

        if (beforeUnload) window.onbeforeunload = undefined;

        $.post("/relationship-editor", data)
            .success(function() {
                window.location.replace("/release/" + self.GID);
            })
            .error(function(jqXHR) {
                try {
                    self.handlerErrors(JSON.parse(jqXHR.responseText), changed);
                } catch(e) {
                    self.submissionLoading(false);
                    self.submissionError(MB.text.SubmissionError);
                }
                if (beforeUnload) window.onbeforeunload = beforeUnload;
            });
    },

    handlerErrors: function(data, changed) {
        _.each(data.errors, function(keys, num) {
            var relationship = changed[num];

            _.each(keys, function(error, key) {
                var parts = key.split(".");

                if (parts[0] == "entity") {
                    relationship.entity[parts[1]].error(error[0]);

                } else if (parts[1] == "begin_date" || parts[1] == "end_date") {
                    relationship[parts[1]].error(error[0]);

                } else if (parts.length == 1 && _.isObject(relationship[key]) &&
                    _.isFunction(relationship[key].error)) {

                    relationship[key].error(error[0]);
                } else {
                    relationship.errorCount += 1;
                    relationship.hasErrors(true);
                }
            });
        });
        this.submissionLoading(false);
        this.submissionError(data.message);
    },

    releaseLoaded: function (data) {
        var release = MB.entity(data, "release")
        .extend({
            releaseGroup: MB.entity(data.releaseGroup, "release_group"),
            mediums: _.map(data.mediums, MB.entity.Medium)
        });

        RE.releaseViewModel.release(release);

        var trackCount = _.reduce(release.mediums,
            function (memo, medium) { return memo + medium.tracks.length }, 0);

        initButtons();
        initCheckboxes(trackCount);
    }
};


UI.init = function(releaseGID, releaseGroupGID, data) {
    RE.releaseViewModel.GID = releaseGID;

    $tracklist = $("#tracklist tbody");
    // preload image to avoid flickering
    $("<img/>").attr("src", "../../../static/images/icons/add.png");

    ko.applyBindings(RE.releaseViewModel, document.getElementById("content"));

    MB.utility.computedWith(function (release) {
        var hasChanges = release.hasRelationshipChanges() ||
                         release.releaseGroup.hasRelationshipChanges();

        window.onbeforeunload = hasChanges ?
            _.constant(MB.text.ConfirmNavigation) : undefined;

    }, RE.releaseViewModel.release);

    if (data) {
        RE.releaseViewModel.releaseLoaded(data);
    } else {
        var url = "/ws/js/release/" + releaseGID + "?inc=recordings+rels+media",
            $loading = $(UI.loadingIndicator).insertAfter("#tracklist");

        $.getJSON(url, function(data) {
            RE.releaseViewModel.releaseLoaded(data);
            $loading.remove();
        });
    }
};


UI.loadingIndicator =
    '<span class="loading">' +
        '<img src="../../../static/images/icons/loading.gif" class="bottom"/> ' +
         MB.text.Loading +
    '</span>';


RE.createWorks = function(works, editNote, success, error) {
    var fields = {};

    _.each(works, function(work, i) {
        var prefix = ["create-works", "works", i, ""].join(".");
        fields[prefix + "name"] = _.str.clean(work.name);
        fields[prefix + "comment"] = _.str.clean(work.comment);
        fields[prefix + "type_id"] = work.type;
        fields[prefix + "language_id"] = work.language;
    });

    fields["create-works.edit_note"] = _.str.trim(editNote);
    $.post("/relationship-editor/create-works", fields).success(success).error(error);
};


var recordingCheckboxes = "td.recording > input[type=checkbox]";
var workCheckboxes = "td.works > div.ar > input[type=checkbox]";


UI.checkedRecordings = function() {
    return $.map($(recordingCheckboxes + ":checked", $tracklist), ko.dataFor);
};


UI.checkedWorks = function() {
    return $.map($(workCheckboxes + ":checked", $tracklist), ko.dataFor);
};


function initCheckboxes(trackCount) {

    var medium_recording_selector = "input.medium-recordings",
        medium_work_selector = "input.medium-works",
        checkboxes = RE.releaseViewModel.checkboxes;

    // get translated strings for the checkboxes
    function getPlurals(singular, plural, max, name) {

        var url = "/ws/js/plurals?singular=" + encodeURIComponent(singular) +
                  "&plural=" + encodeURIComponent(plural) + "&max=" + max;

        $.getJSON(url, function(data) {
            checkboxes[name](data.strings);
        });
    }
    getPlurals("{n} recording selected", "{n} recordings selected", trackCount, "recordingStrings");
    getPlurals("{n} work selected", "{n} works selected", Math.max(10, Math.min(trackCount * 2, 100)), "workStrings");

    function count($inputs) {
        return _.uniq($inputs, ko.dataFor).length;
    }

    function medium(medium_selector, selector, counter) {
        $tracklist.on("change", medium_selector, function(event) {
            var checked = this.checked,
                $changed = $(this).parents("tr.subh").nextUntil("tr.subh")
                    .find(selector).filter(checked ? ":not(:checked)" : ":checked")
                    .prop("checked", checked);
            counter(counter() + count($changed) * (checked ? 1 : -1));
        });
    }

    function _release(medium_selector, cls) {
        $('<input type="checkbox"/>&#160;')
            .change(function(event) {
                $tracklist.find(medium_selector)
                    .prop("checked", this.checked).change();
            })
            .prependTo("#tracklist th." + cls);
    }

    function range(selector, counter) {
        var last_clicked = null;

        $tracklist.on("click", selector, function(event) {
            var checked = this.checked, $inputs = $(selector, $tracklist);
            if (event.shiftKey && last_clicked && last_clicked != this) {
                var first = $inputs.index(last_clicked), last = $inputs.index(this);

                (first > last
                    ? $inputs.slice(last, first + 1)
                    : $inputs.slice(first, last + 1))
                    .prop("checked", checked);
            }
            counter(count($inputs.filter(":checked")));
            last_clicked = this;
        });
    }

    medium(medium_recording_selector, recordingCheckboxes, checkboxes.recordingCount);
    medium(medium_work_selector, workCheckboxes, checkboxes.workCount);

    _release(medium_recording_selector, "recordings");
    _release(medium_work_selector, "works");

    range(recordingCheckboxes, checkboxes.recordingCount);
    range(workCheckboxes, checkboxes.workCount);
}


function initButtons() {
    $("#batch-recording").click(function() {
        var targets = UI.checkedRecordings();

        if (targets.length > 0) {
            UI.BatchRelationshipDialog(targets).open();
        }
    });

    $("#batch-work").click(function() {
        var targets = UI.checkedWorks();

        if (targets.length > 0) {
            UI.BatchRelationshipDialog(targets).open();
        }
    });

    $("#batch-create-works").click(function() {
        var targets = _.filter(UI.checkedRecordings(), function (recording) {
            return recording.performanceRelationships.peek().length === 0;
        });

        if (targets.length > 0) {
            UI.BatchCreateWorksDialog(targets).open();
        }
    });

    $("#content").on("click", "span.add-rel", function(event) {
        var source = ko.dataFor(this),
            target = MB.entity({ type: "artist" });

        UI.AddDialog({ source: source, target: target }).open(this);
    });

    $("#content").on("click", "span.relate-work", function() {
        var source = ko.dataFor(this).recording,
            target = MB.entity({ type: "work", name: source.name });

        UI.AddDialog({ source: source, target: target }).open();
    });

    $("#content").on("click", "span.remove-button", function() {
        var relationship = ko.dataFor(this), action = relationship.action(), newAction = "remove";

        if (action == "add") {
            $(this).parent().children("input[type=checkbox]:checked")
                .prop("checked", false).click();
            relationship.remove();
            return;
        }
        if (action == "remove") newAction = "";

        if (action == "edit" && newAction == "remove")
            relationship.fromJS(relationship.original_fields);

        relationship.action(newAction);
    });

    $("#content").on("click", "span.link-phrase", function(event) {
        var relationship = ko.dataFor(this),
            source = ko.dataFor(this.parentNode.parentNode);

        if (relationship.action() !== "remove") {
            UI.EditDialog({ relationship: relationship, source: source }).open(this);
        }
    });
}


$(MB.confirmNavigationFallback);

return RE;

}(MB.RelationshipEditor || {}));
