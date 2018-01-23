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
  *
  * https://github.com/DavidValeri/kumoapp-open-close-temperature
  *
  * Configure multiple forms of notifications and optional repeat notifications 
  * based on opening and closing or temperature monitoring.
  *
  * While the capabilities here might seem like of duplication of those in the
  * user interface, choosing a delayed response in the user interface also
  * delays the event from entering the graphs and event log at the time it
  * actually happened.  I find this behavior frustrating as the event log should
  * be a log of events, not a log of when notifications were triggered.  I view
  * these two aspects of the system as orthogonal and prefer to have an
  * authoritative event list to view at a glance that is not contingent on the
  * event triggering a notification.  Furthermore, when using the built-in
  * notification delays, the event log becomes populated with unbalanced events
  * as the log contains close events without corresponding open events.
  *
  * This application also introduces the ability to control the tag beeper as
  * a notification mechanism and to configure different notificaiton schemes
  * for different notification mediums.  These features are not available in
  * the user interface.
  */
 
var MILLISECONDS_PER_MIN = 60 * 1000;

var EVENT_STATE_DISARMED = 0;

var TEMP_STATE_NOT_MONITORING = 0;
var TEMP_STATE_NORMAL = 1;
var TEMP_STATE_HIGH = 2;
var TEMP_STATE_LOW = 3;

var BEEPER_MODE_OFF = 0;
var BEEPER_MODE_ON_AFTER_DELAY = 1;
var BEEPER_MODE_ON = 2;
var BEEPER_MODE_ON_OFF = 3

/**
 * Map of sensor IDs to sensor state for motion notifications.  The state
 * structure is:
 * {
 *   notificationTimer: the timer used to manage notifications for the tag
 *   beeperTimer: the timer used to manage the beeper for the tag
 *   triggerTick: the tick that the tag was initially triggered
 *   tag: the tag related to the state
 *   beeperEnabled: boolean indicting if this app enabled the beeper on the tag
 *   initialDelay: boolean indicating if we have completed the initial delay
 * }
 */
var motionStates = {};
/**
 * Map of sensor IDs to sensor state for temperature notifications.  The state
 * structure is:
 * {
 *   notificationTimer: the timer used to manage notifications for the tag
 *   triggerTick: the tick that the tag was initially triggered
 *   tag: the tag related to the state
 *   initialDelay: boolean indicating if we have completed the initial delay
 * }
 */
var temperatureStates = {};

// G E N E R A L  C O  N F I G /////////////////////////////////////////////////
var tags = <#Door or window tags used to trigger the application_[12|13|21|52]_N#>;
var initialMotionDelay = <%The initial delay for motion triggers, in minutes, before the first notification_N%> * MILLISECONDS_PER_MIN;
var initialTemperatureDelay = <%The initial delay for temperature triggers, in minutes, before the first notification_N%> * MILLISECONDS_PER_MIN;
var repeatDelay = <%The delay, in minutes, between optional repeat notifications. Enter 0 to disable repeat notifications_N%> * MILLISECONDS_PER_MIN;

// B E E P E R  C O N F I G ////////////////////////////////////////////////////
var beeperMode = <%Enable the tag beeper based on the motion trigger.  Enter 0 to disable the beeper, 1 to enable the tag beeper after the initial delay has elapsed, 2 to enable the tag beeper immediately, or 3 to enable the tag beeper briefly on open and on close_N%>;

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
var emailAddresses = !!emailAddressesString
    && emailAddressesString.split(" *, *");

/**
 * Calculates the open duration in minutes for the given state.
 */
function calculateDurationInMinutes(state) {
  return Math.round(
      (KumoApp.Tick - state.triggerTick) / MILLISECONDS_PER_MIN);
}

/**
 * Returns "s" or empty string depending on if value would make a word plural
 * or not in a log message.
 */
function pluralize(value) {
  return value > 1 ? "s" : "";
}

/**
 * Turns 0 into nicer to read words for use in notificaiton messages.
 */
function pretifyZeroMinutes(value) {
  return value === 0 ? "less than 1" : value;
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
  try {
    if (enableIfttt) {
      KumoApp.Log(message, iftttType);
    }
    else {
      KumoApp.Log(message);  
    }
  }
  catch(e) {
    KumoApp.Log("Error logging message / IFTTT trigger: " + e);
  }
}

/**
 * Notify via email.
 */
function notifyEmail(tagName, message) {
  
  emailAddresses.forEach(
      function(emailAddress) {
        try {      
          KumoApp.Email(
              emailAddress,
              "Update: " + tagName,
              message);
        }
        catch(e) {
          KumoApp.Log("Error notifying [" + emailAddress + "]: " + e);
        }
      });
}

/**
 * Notify via push.
 */
function notifyPush(tagName, message) {
  try {    
    pushTarget.push(
        "Update: " + tagName,
        message,
        "Alarm Frenzy");
  }
  catch(e) {
    KumoApp.Log("Error notifying push targets: " + e);
  }
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
 * Handle the motion notification timer firing on 'state'.
 */
function onMotionNotificationTimer(state) {
  var openDurationMinutes,
      timer = state.notificationTimer;

  KumoApp.Log(
      "Handling motion notification timer [" + timer + "] for tag ["
          + state.tag.name + "]");

  if (state.initialDelay) {
    stopNotificationTimer(state);
    if (!!repeatDelay && repeatDelay > 0) {
      state.notificationTimer = KumoApp.setInterval(
        function() {
          onMotionNotificationTimer(state);
        },
        repeatDelay);
    }

    state.initialDelay = false;
  }

  openDurationMinutes = calculateDurationInMinutes(state);
  notify(
      state.tag.name,
      state.tag.name + " open for "
          + pretifyZeroMinutes(openDurationMinutes) + " minute"
          + pluralize(openDurationMinutes) + ".");
}

/**
 * Handle the beeper timer firing on 'state'.
 */
function onBeeperTimer(state) {
  var timer = state.beeperTimer;

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
 * Handle the temperature notification timer firing on 'state'.
 */
function onTemperatureNotificationTimer(state) {
  var openDurationMinutes,
      timer = state.notificationTimer;

  KumoApp.Log(
      "Handling temperature notification timer [" + timer + "] for tag ["
          + state.tag.name + "]");

  if (state.initialDelay) {
    stopNotificationTimer(state);
    if (!!repeatDelay && repeatDelay > 0) {
      state.notificationTimer = KumoApp.setInterval(
        function() {
          onTemperatureNotificationTimer(state);
        },
        repeatDelay);
    }

    state.initialDelay = false;
  }

  openDurationMinutes = calculateDurationInMinutes(state);
  notify(
      state.tag.name,
      state.tag.name + " out of normal temperature range for "
          + pretifyZeroMinutes(openDurationMinutes) + " minute"
          + pluralize(openDurationMinutes) + ".");
}

/**
 * Handle the open event for 'tag'.
 */
function onOpen(tag) {
  KumoApp.Log("Handling tag [" + tag.name + "] open.");

  var state = {
    triggerTick: KumoApp.Tick,
    notificationTimer: null,
    beeperTimer: null,
    tag: tag,
    beeperEnabled: false,
    initialDelay: true
  };

  motionStates[tag.uuid] = state;

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
          initialMotionDelay);
      break;
  }

  state.notificationTimer = KumoApp.setInterval(
      function() {
        onMotionNotificationTimer(state);
      },
      initialMotionDelay);
}

/**
 * Handle the close event for 'tag'.
 */
function onClose(tag) {
  var state = motionStates[tag.uuid],
      openDurationMinutes;

  KumoApp.Log("Handling tag [" + tag.name + "] close.");

  if (state) {
    stopTimers(state);
    delete motionStates[tag.uuid];

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
      durationMinutes = calculateDurationInMinutes(state);
      notify(
          state.tag.name,
          state.tag.name + " closed after being open for "
              + pretifyZeroMinutes(durationMinutes) + " minute"
              + pluralize(durationMinutes) + ".");
    }
  }
}

function onTemperatureCross(tag) {
  var state = temperatureStates[tag.uuid],
      durationMinutes;
  
  KumoApp.Log("Handling tag [" + tag.name + "] temperature cross.");

  // Existing state, so this is an update to a previously out of range tag.
  if (state) {
    switch (tag.tempState) {
      // Back to normal
      case TEMP_STATE_NORMAL:
        // If we have made a notification about it, notify that things are back
        // to normal.
        if (!state.initialDelay) {
          durationMinutes = calculateDurationInMinutes(state);
          notify(
              state.tag.name,
              state.tag.name + " returned to normal temperature range "
                  + "after being out of normal temperature range for "
                  + pretifyZeroMinutes(durationMinutes)
                  + " minute" + pluralize(durationMinutes) + ".");
        }

        stopTimers(state);
        delete temperatureStates[tag.uuid];
        break;
      // Things are still out of range but perhaps oscillating?  In either case
      // we don't do anything
      case TEMP_STATE_HIGH:
      case TEMP_STATE_LOW:
        // No-Op
        break;
    }
  }
  // No existing state so this is the first time out of range trigger.  If it
  // is indicating non-normal, setup state and start the initial delay timer.
  else if (tag.tempState === TEMP_STATE_HIGH
      || tag.tempState === TEMP_STATE_LOW) {
    var state = {
      triggerTick: KumoApp.Tick,
      notificationTimer: null,
      tag: tag,
      initialDelay: true
    };

    temperatureStates[tag.uuid] = state;

    state.notificationTimer = KumoApp.setInterval(
      function() {
        onTemperatureNotificationTimer(state);
      },
      initialTemperatureDelay);
  }
}

/**
 * Examine a generic updates on 'tag' to cover the case of an tag in an open
 * state being disarmed without first being closed or a tag in an out of range
 * temperature state having temperature monitoring turned off without first
 * returning to an in range condition.
 */
function onUpdate(tag) {
  var state,
      durationMinutes;

  KumoApp.Log(
      "Handling tag [" + tag.name + "] update.  Current state is ["
          + JSON.stringify(tag) + "].");

  if (tag.eventState == EVENT_STATE_DISARMED) {
    state = motionStates[tag.uuid];
    if (state) {
      stopTimers(state);
      delete motionStates[tag.uuid];

      if (state.beeperEnabled) {
        state.tag.stopBeep();
      }

      if (!state.initialDelay) {
        durationMinutes = calculateDurationInMinutes(state);

        notify(
            state.tag.name,
            state.tag.name + " disarmed after being open for "
                + pretifyZeroMinutes(durationMinutes) + " minute"
                + pluralize(durationMinutes) + ".");
      }
    }
  }

  if (tag.tempState == TEMP_STATE_NOT_MONITORING) {
    state = temperatureStates[tag.uuid];
    if (state) {
      stopTimers(state);
      delete temperatureStates[tag.uuid];

      if (!state.initialDelay) {
        durationMinutes = calculateDurationInMinutes(state);
        message = state.tag.name + " disarmed after being out of normal "
            + "temperature range for " + pretifyZeroMinutes(durationMinutes)
            + " minute" + pluralize(durationMinutes) + ".";

        notify(state.tag.name, message);
      }
    }
  }
}

/**
 * Handle cleanup of motion related state on application stop for the tag with
 * ID 'tagId'.
 */
function onStopMotionState(tagId) {
    var state = motionStates[tagId];
    stopTimers(state);
    delete motionStates[tagId];

    if (state.beeperEnabled) {
      state.tag.stopBeep();
    }
}

/**
 * Handle cleanup of temperature related state on application stop for the tag
 * with ID 'tagId'.
 */
function onStopTemperatureState(tagId) {
    var state = temperatureStates[tagId];
    stopTimers(state);
    delete temperatureStates[tagId];
}

// Bind the KumoApp shutdown hook to cleanup when the app is stopped.
KumoApp.OnStop = function() {
  Object.keys(motionStates)
      .forEach(onStopMotionState);
      
  Object.keys(temperatureStates)
       .forEach(onStopTemperatureState);
};

// Bind the event handlers to the tags
tags.forEach(
    function(t) {
      t.opened = onOpen;
      t.closed = onClose;
      t.updated = onUpdate;
      t.temperatureCross = onTemperatureCross;
    });
