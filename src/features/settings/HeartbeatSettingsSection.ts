import { Setting } from 'obsidian';

import type { FeatureHost } from '../FeatureHost';

/** Heartbeat (fork-only): settings for the background vault daemon. */
export function renderHeartbeatSettingsSection(container: HTMLElement, plugin: FeatureHost): void {
  new Setting(container).setName('Heartbeat').setHeading();

  new Setting(container)
    .setName('Enable heartbeat')
    .setDesc('Periodically wake Claude in the background to update the vault daemon state.')
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings.heartbeatEnabled)
        .onChange(async (value) => {
          await plugin.mutateSettings((settings) => {
            settings.heartbeatEnabled = value;
          });
          if (value) {
            plugin.heartbeat.start();
          } else {
            plugin.heartbeat.stop();
          }
        }),
    );

  new Setting(container)
    .setName('Interval (minutes)')
    .setDesc('How often the heartbeat fires.')
    .addSlider((slider) =>
      slider
        .setLimits(5, 120, 5)
        .setValue(plugin.settings.heartbeatIntervalMinutes)
        .setDynamicTooltip()
        .onChange(async (value) => {
          await plugin.mutateSettings((settings) => {
            settings.heartbeatIntervalMinutes = value;
          });
          if (plugin.settings.heartbeatEnabled) {
            plugin.heartbeat.restart();
          }
        }),
    );

  new Setting(container)
    .setName('Max turns')
    .setDesc('Maximum SDK turns the heartbeat can take per tick before terminating.')
    .addSlider((slider) =>
      slider
        .setLimits(1, 40, 1)
        .setValue(plugin.settings.heartbeatMaxTurns)
        .setDynamicTooltip()
        .onChange(async (value) => {
          await plugin.mutateSettings((settings) => {
            settings.heartbeatMaxTurns = value;
          });
        }),
    );

  new Setting(container)
    .setName('Model')
    .setDesc('Model alias or ID used by the heartbeat. Leave empty to use haiku (lowest cost).')
    .addText((text) =>
      text
        .setValue(plugin.settings.heartbeatModel)
        .onChange(async (value) => {
          await plugin.mutateSettings((settings) => {
            settings.heartbeatModel = value.trim() || 'haiku';
          });
        }),
    );

  new Setting(container)
    .setName('Quiet hours start (hh:mm)')
    .setDesc('Heartbeat is suppressed between quiet-start and quiet-end (24h format).')
    .addText((text) =>
      text
        .setPlaceholder('22:00')
        .setValue(plugin.settings.heartbeatQuietStart)
        .onChange(async (value) => {
          await plugin.mutateSettings((settings) => {
            settings.heartbeatQuietStart = value.trim() || '22:00';
          });
        }),
    );

  new Setting(container)
    .setName('Quiet hours end (hh:mm)')
    .addText((text) =>
      text
        .setPlaceholder('06:00')
        .setValue(plugin.settings.heartbeatQuietEnd)
        .onChange(async (value) => {
          await plugin.mutateSettings((settings) => {
            settings.heartbeatQuietEnd = value.trim() || '06:00';
          });
        }),
    );

  new Setting(container)
    .setName('Pause while streaming')
    .setDesc('Skip the heartbeat when any tab is actively streaming a response.')
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings.heartbeatPauseOnStreaming)
        .onChange(async (value) => {
          await plugin.mutateSettings((settings) => {
            settings.heartbeatPauseOnStreaming = value;
          });
        }),
    );
}
