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
  * v1.0.0
  */
 
var MILLISECONDS_PER_MIN = 60 * 1000;

var EVENT_STATE_DISARMED = 0;

var BEEPER_MODE_OFF = 0;
var BEEPER_MODE_ON_AFTER_DELAY = 1;
var BEEPER_MODE_ON = 2;
var BEEPER_MODE_ON_OFF = 3

/**
 * Map of sensor IDs to sensor state.  The state structure is:
 * {
 *   notificationTimer: the timer used to manage notifications for the tag
 *   beeperTimer: the timer used to manage the beeper for the tag
 *   initialOpenTick: the date that the tag was initially marked as open
 *   tag: the tag related to the state
 *   beeperEnabled: boolean indicting if this app enabled the beeper on the tag
 *   initialDelay: boolean indicating if we have completed the initial delay
 * }
 */
var states = {}
var tags = <#Door or window tags used to trigger the application_[12|13|21|52]_N#>;
var initialDelay = <%The initial delay, in minutes, before the first notification_N%> * MILLISECONDS_PER_MIN;
var repeatDelay = <%The delay, in minutes, between optional repeat notifications. Enter 0 to disable repeat notifications_N%> * MILLISECONDS_PER_MIN;

// B E E P E R  C O N F I G ////////////////////////////////////////////////////
var beeperMode = <%Enable the tag beeper.  Enter 0 to disable the beeper, 1 to enable the tag beeper after the initial delay has elapsed, 2 to enable the tag beeper immediately, or 3 to enable the tag beeper briefly on open and on close_N%>;

// N O T I F I C A T I O N  M E C H A N I S M  C O N F I G /////////////////////
var iftttType = <%The "Type" used to trigger the IFTTT "New KumoApp message" trigger.  Enter 0 to disable and a value greater than 2 and less than or equal to 255 to enable IFTTT notifications_N%>;
var emailAddressesString = <%The comma separated list of email addresses to notify.  Enter " " to disable email notifications%>;
var pushTarget = <~The mobile devices to notify.~>

/**
 * If IFTTT notifications are enabled.
 */ 
var enableIfttt = !!iftttType && iftttType > 2 && iftttType <= 255;

/**
 * The array of email addresses to notify.
 */ 
var emailAddresses = !!emailAddressesString && emailAddressesString.split(" *, *");

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
    notifyPush(tagName, message);
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
 * Notify via push.
 */
function notifyPush(tagName, message) {
  emailAddresses.forEach(
      function(emailAddress) {
        pushTarget.push("Update: " + tagName, message);
      });
}

/**
 * Stop all timers associated with 'state'.
 */
function stopTimers(state) {
    stopNotificationTimer(state);
    stopBeeperTimer(state);
}

/**
 * Stops the notification timer associated with 'state' and removes the timer
 * from 'state'.
 */
function stopNotificationTimer(state) {
  if (state.notificationTimer) {
    KumoApp.Log("Stopping notification timer ["
        + state.notificationTimer + "].");
    KumoApp.stopTimer(state.notificationTimer);
    state.notificationTimer = null;
  }
}

/**
 * Stops the beeper timer associated with 'state' and removes the timer
 * from 'state'.
 */
function stopBeeperTimer(state) {
  if (state.beeperTimer) {
    KumoApp.Log("Stopping beeper timer [" + state.beeperTimer + "].");
    KumoApp.stopTimer(state.beeperTimer);
    state.beeperTimer = null;
  }
}

/**
 * Handle the notification timer firing on 'state'.
 */
function onNotificationTimer(state) {
  var openDurationMinutes,
      minuteSuffix,
      message,
      timer = state.notificationTimer;

  KumoApp.Log(
      "Handling notification timer [" + timer + "] for tag ["
          + state.tag.name + "]");

    if (state.initialDelay) {
      stopNotificationTimer(state);
      if (!!repeatDelay && repeatDelay > 0) {
        state.notificationTimer = KumoApp.setInterval(
          function() {
            onNotificationTimer(state);
          },
          repeatDelay);
      }
    }

    state.initialDelay = false;

    openDurationMinutes = calculateOpenDurationInMinutes(state);
    minuteSuffix = pluralize(openDurationMinutes);
    message = state.tag.name + " open for " + openDurationMinutes + " minute"
        + minuteSuffix + "."

    notify(state.tag.name, message);
}

/**
 * Handle the beeper timer firing on 'state'.
 */
function onBeeperTimer(state) {
  var openDurationMinutes,
      minuteSuffix,
      message,
      timer = state.beeperTimer;

  KumoApp.Log(
      "Handling beeper timer [" + timer + "] for tag ["
          + state.tag.name + "]");
    
  switch (beeperMode) {
    case BEEPER_MODE_ON_AFTER_DELAY:
    case BEEPER_MODE_ON:
        state.beeperEnabled = state.tag.beep(1000) !== null;
        stopBeeperTimer(state);
        if (!state.beeperEnabled) {
          state.beeperTimer = KumoApp.setInterval(
            function() {
              onBeeperTimer(state);
            },
            2000);
        }
        break;
  }
}

/**
 * Handle the open event for 'tag'.
 */
function onOpen(tag) {
  KumoApp.Log("Handling tag [" + tag.name + "] open.");

  var state = {
    initialOpenTick: KumoApp.Tick,
    notificationTimer: null,
    beeperTimer: null,
    tag: tag,
    beeperEnabled: false,
    initialDelay: true
  };

  states[tag.uuid] = state;
  
  
  switch (beeperMode) {
    case BEEPER_MODE_ON:
      state.beeperEnabled = state.tag.beep(1000) !== null;
      if (!state.beeperEnabled) {
        state.beeperTimer = KumoApp.setInterval(
            function() {
              onBeeperTimer(state);
            },
            2000);
      }
      break;
    case BEEPER_MODE_ON_OFF:
      state.beeperEnabled = state.tag.beep(2) !== null;
      break;
    case BEEPER_MODE_ON_AFTER_DELAY:
      state.beeperTimer = KumoApp.setInterval(
          function() {
            onBeeperTimer(state);
          },
          initialDelay);
      break;
  }

  state.notificationTimer = KumoApp.setInterval(
      function() {
        onNotificationTimer(state);
      },
      initialDelay);
}

/**
 * Handle the close event for 'tag'.
 */
function onClose(tag) {
  var state = states[tag.uuid],
      openDurationMinutes,
      minuteSuffix,
      message;

  KumoApp.Log("Handling tag [" + tag.name + "] close.");

  if (state) {
    stopTimers(state);
    delete states[tag.uuid];

    switch (beeperMode) {
      case BEEPER_MODE_ON_OFF:
        state.beeperEnabled = state.tag.beep(3) !== null;
        break;
      default:
        if (state.beeperEnabled) {
          state.tag.stopBeep();
        }
    }

    if (!state.initialDelay) {
      openDurationMinutes = calculateOpenDurationInMinutes(state);
      minuteSuffix = pluralize(openDurationMinutes);
      message = state.tag.name + " closed after being open for "
          + openDurationMinutes + " minute" + minuteSuffix + ".";

      notify(state.tag.name, message)
    }
  }
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

  KumoApp.Log("Handling tag [" + tag.name + "] update.");
  if (state && tag.eventState == EVENT_STATE_DISARMED) {
    stopTimers(state);
    delete states[tag.uuid];

    if (state.beeperEnabled) {
      state.tag.stopBeep();
    }

    if (!state.initialDelay) {
      openDurationMinutes = calculateOpenDurationInMinutes(state);
      minuteSuffix = pluralize(openDurationMinutes);
      message = state.tag.name + " disarmed after being open for "
          + openDurationMinutes + " minute" + minuteSuffix + ".";

      notify(state.tag.name, message);
    }
  }
}

/**
 * Handle cleanup on application stop for the tag with ID 'tagId'.
 */
function onStop(tagId) {
    var state = states[tagId];
    stopTimers(state);
    delete states[tagId];

    if (state.beeperEnabled) {
      state.tag.stopBeep();
    }
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
