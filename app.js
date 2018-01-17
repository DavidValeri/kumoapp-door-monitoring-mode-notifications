/**
 * Copyright 2018 David Valeri
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * 
 *     http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Map of sensor IDs to sensor state.  The state structure is:
 * {
 *   timer: the timer used to manage state for the tag
 *   state: the enum value used to track the current state of the application for the tag
 *   initialOpenTick: the date that the tag was initially marked as open
 *   tag: the tag related to the state
 *   beeperEnabled: boolean indicting if this app enabled the beeper on the tag
 *   isInitialDelay: boolean indicating if we have completed the initial delay
 * }
 */
var states = {}
var tags = <#Door or window tags used to trigger the application_[12|13|21|52]_N#>;
var initialDelayMinutes = <%The initial delay, in minutes, before the first notification_N%>;
var repeatDelayMinutes = <%The delay, in minutes, between optional repeat notifications. Enter 0 to disable repeat notifications_N%>;
var enableBeeper = !!<%Enable the tag beeper once notification delay elapses.  Enter 0 to disable the beeper and 1 to enable the tag beeper after the initial delay has elapsed_N%>;
var iftttType = <%The "Type" used to trigger the IFTTT "New KumoApp message" trigger.  Enter 0 to disable and a value greater than 2 and less than or equal to 255 to enable IFTTT notifications_N%>;
var emailAddressesString = <%The comma separated list of email addresses to notify.  Enter " " to disable email notifications%>;

/**
 * If IFTTT notifications are enabled.
 */ 
var enableIfttt = !!iftttType && iftttType > 2 && iftttType <= 255;

/**
 * The array of email addresses to notify.
 */ 
var emailAddresses = !!emailAddressesString && emailAddressesString.split(" *, *");

var MILLISECONDS_PER_MIN = 60 * 1000;

/**
 * Calculates the open duration in minutes for the given state.
 */
function calculateOpenDurationInMinutes(state) {
  return Math.ceil(
      (KumoApp.Tick - state.initialOpenTick) / MILLISECONDS_PER_MIN);
}

/**
 * Returns "s" or empty string depending on if value would make a word plural
 * or not in a log message.
 */
function pluralize(value) {
  return value !== 1 && value !== -1 ? "s" : "";
}

/**
 * Send notifications to all enabled notification systems.
 */ 
function notify(tagName, message) {
    notifyIfttt(message);
    notifyEmail(tagName, message);
}

/**
 * Notify via IFTTT "New KumoApp message" trigger.
 */
function notifyIfttt(message) {
  if (enableIfttt) {
    KumoApp.Log(message, iftttType);
  }
  else {
    KumoApp.Log(message);  
  }
}

/**
 * Notify via email.
 */
function notifyEmail(tagName, message) {
  emailAddresses.forEach(
      function(emailAddress) {
         KumoApp.Email(
             emailAddress,
             "Update: " + tagName,
             message);
      });
}

/**
 * Stops the timer associated with 'state' and removes the timer from 'state'.
 */
function stopTimer(state) {
  if (state.timer) {
    KumoApp.Log("Stopping timer [" + state.timer + "].");
    KumoApp.stopTimer(state.timer);
    state.timer = null;
  }
}

/**
 * Handle the timer firing on 'state'.
 */
function onTimer(state) {
  var openDurationMinutes,
      minuteSuffix,
      message,
      timer = state.timer;

  KumoApp.Log(
      "Handling timer [" + state.timer + "] for tag ["
          + state.tag.uuid + "]");

    if (enableBeeper && !state.beeperEnabled) {
      if (state.tag.beep(1000) !== null) {
        state.beeperEnabled = true;   
      }
    }

    if (state.isInitialDelay) {
      stopTimer(state);
      if (!!repeatDelayMinutes && repeatDelayMinutes > 0) {
        state.timer = KumoApp.setInterval(
          function() {
            onTimer(state);
          },
          repeatDelayMinutes * MILLISECONDS_PER_MIN);
      }
    }

    state.isInitialDelay = false;

    openDurationMinutes = calculateOpenDurationInMinutes(state);
    minuteSuffix = pluralize(openDurationMinutes);
    message = state.tag.name + " open for " + openDurationMinutes + " minute"
        + minuteSuffix + "."

    notify(state.tag.name, message);

    KumoApp.Log(
      "Timer [" + timer + "] for tag ["
          + state.tag.uuid + "] completed.");
}

/**
 * Handle the open event for 'tag'.
 */
function onOpen(tag) {
  KumoApp.Log("Handling tag [" + tag.uuid + "] open.");

  var state = {
    initialOpenTick: KumoApp.Tick,
    timer: null,
    tag: tag,
    beeperEnabled: false,
    isInitialDelay: true
  };

  states[tag.uuid] = state;

  state.timer = KumoApp.setInterval(
      function() {
        onTimer(state);
      },
      initialDelayMinutes * MILLISECONDS_PER_MIN);

  KumoApp.Log("Tag [" + tag.uuid + "] opened.");
}

/**
 * Handle the close event for 'tag'.
 */
function onClose(tag) {
  var state = states[tag.uuid],
      openDurationMinutes,
      minuteSuffix,
      message;

  KumoApp.Log("Handling tag [" + tag.uuid + "] close.");

  if (state) {
    stopTimer(state);
    delete states[tag.uuid];
    
    if (state.beeperEnabled) {
      state.tag.stopBeep();
    }

    if (!state.isInitialDelay) {
      openDurationMinutes = calculateOpenDurationInMinutes(state);
      minuteSuffix = pluralize(openDurationMinutes);
      message = state.tag.name + " closed after being open for "
          + openDurationMinutes + " minute"
          + minuteSuffix + ".";

      notify(state.tag.name, message)
    }
  }
  KumoApp.Log("Tag [" + tag.uuid + "] closed.");
}

/**
 * Examine a generic updates on 'tag' to cover the case of an tag in an open
 * state being disarmed without first being closed.
 */
function onUpdate(tag) {
  var state = states[tag.uuid],
      openDurationMinutes,
      minuteSuffix,
      message;

  KumoApp.Log("Handling tag [" + tag.uuid + "] update.");
  if (state && tag.eventState == 0) {
    stopTimer(state);
    delete states[tag.uuid];

    if (state.beeperEnabled) {
      state.tag.stopBeep();
    }

    if (!state.isInitialDelay) {
      openDurationMinutes = calculateOpenDurationInMinutes(state);
      minuteSuffix = pluralize(openDurationMinutes);
      message = state.tag.name + " disarmed after being open for "
          + openDurationMinutes + " minute"
          + minuteSuffix + ".";

      notify(state.tag.name, message);
    }
  }
  KumoApp.Log("Tag [" + tag.uuid + "] updated.");
}

/**
 * Handle cleanup on application stop for the tag with ID 'tagId'.
 */
function onStop(tagId) {
    var state = states[tagId];
    stopTimer(state);
    delete states[tagId];
    state.tag.stopBeep();
}

// Bind the KumoApp shutdown hook to cleanup when the app is stopped.
KumoApp.OnStop = function() {
  Object.keys(states)
      .forEach(onStop);
};

// Bind the event handlers to the tags
tags.forEach(
    function(t) {
      t.opened = onOpen;
      t.closed = onClose;
      t.updated = onUpdate;
    });
