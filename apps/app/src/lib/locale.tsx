import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { LocaleContext, type Locale, type LocaleContextValue } from '@/lib/locale-context'

const LOCALE_STORAGE_KEY = 'holycrab.locale'

type TranslationKey =
  | 'common.refresh'
  | 'common.checking'
  | 'runtimeSession.title'
  | 'runtimeSession.status.idle'
  | 'runtimeSession.status.running'
  | 'runtimeSession.status.success'
  | 'runtimeSession.status.failed'
  | 'runtimeSession.detail.idle'
  | 'runtimeSession.detail.running'
  | 'runtimeSession.detail.success'
  | 'runtimeSession.detail.failed'
  | 'runtimeSession.detail.ptyRunning'
  | 'runtimeSession.action.upgrade'
  | 'runtimeSession.action.uninstall'
  | 'runtimeSession.action.install'
  | 'runtimeSession.action.open'
  | 'runtimeSession.action.fallback'
  | 'runtimeSession.button.close'
  | 'runtimeSession.terminal.waiting'
  | 'settings.updates.title'
  | 'settings.updates.description'
  | 'settings.updates.currentVersion'
  | 'settings.updates.availableVersion'
  | 'settings.updates.check'
  | 'settings.updates.checking'
  | 'settings.updates.installRestart'
  | 'settings.updates.installing'
  | 'settings.updates.clear'
  | 'settings.updates.noUpdates'
  | 'settings.updates.error'
  | 'settings.updates.status'
  | 'settings.updates.status.available'
  | 'settings.updates.status.downloading'
  | 'settings.updates.status.downloaded'
  | 'settings.updates.downloaded'
  | 'updates.oneClick.label'
  | 'updates.oneClick.title'
  | 'updates.oneClick.subtitle'
  | 'updates.oneClick.status.checking'
  | 'updates.oneClick.status.downloading'
  | 'updates.oneClick.status.installing'
  | 'updates.oneClick.close'
  | 'settings.language.title'
  | 'settings.language.description'
  | 'settings.language.current'
  | 'settings.language.english'
  | 'settings.language.chinese'
  | 'settings.dictation.title'
  | 'settings.dictation.description'
  | 'settings.dictation.enable.title'
  | 'settings.dictation.enable.description'
  | 'settings.dictation.model.label'
  | 'settings.dictation.model.downloadSize'
  | 'settings.dictation.model.note.tiny'
  | 'settings.dictation.model.note.base'
  | 'settings.dictation.model.note.small'
  | 'settings.dictation.model.note.medium'
  | 'settings.dictation.model.note.largeV3'
  | 'settings.dictation.language.label'
  | 'settings.dictation.language.help'
  | 'settings.dictation.language.option.auto'
  | 'settings.dictation.language.option.english'
  | 'settings.dictation.language.option.spanish'
  | 'settings.dictation.language.option.french'
  | 'settings.dictation.language.option.german'
  | 'settings.dictation.language.option.italian'
  | 'settings.dictation.language.option.portuguese'
  | 'settings.dictation.language.option.dutch'
  | 'settings.dictation.language.option.swedish'
  | 'settings.dictation.language.option.norwegian'
  | 'settings.dictation.language.option.danish'
  | 'settings.dictation.language.option.finnish'
  | 'settings.dictation.language.option.polish'
  | 'settings.dictation.language.option.turkish'
  | 'settings.dictation.language.option.russian'
  | 'settings.dictation.language.option.ukrainian'
  | 'settings.dictation.language.option.japanese'
  | 'settings.dictation.language.option.korean'
  | 'settings.dictation.language.option.chinese'
  | 'settings.dictation.holdKey.label'
  | 'settings.dictation.holdKey.off'
  | 'settings.dictation.holdKey.option'
  | 'settings.dictation.holdKey.alt'
  | 'settings.dictation.holdKey.command'
  | 'settings.dictation.holdKey.windows'
  | 'settings.dictation.holdKey.meta'
  | 'settings.dictation.holdKey.shift'
  | 'settings.dictation.holdKey.control'
  | 'settings.dictation.holdKey.help'
  | 'settings.dictation.status.title'
  | 'settings.dictation.status.ready'
  | 'settings.dictation.status.missing'
  | 'settings.dictation.status.downloading'
  | 'settings.dictation.status.errorFallback'
  | 'settings.dictation.status.loading'
  | 'settings.dictation.status.unavailable'
  | 'settings.dictation.status.requestError'
  | 'settings.dictation.actions.download'
  | 'settings.dictation.actions.downloading'
  | 'settings.dictation.actions.cancel'
  | 'settings.dictation.actions.canceling'
  | 'settings.dictation.actions.remove'
  | 'settings.dictation.actions.removing'
  | 'settings.chat.title'
  | 'settings.chat.description'
  | 'settings.chat.display.label'
  | 'settings.chat.display.option.collapsed'
  | 'settings.chat.display.option.contentOnly'
  | 'settings.chat.display.option.full'
  | 'settings.chat.copy.label'
  | 'settings.chat.copy.option.markdown'
  | 'settings.chat.copy.option.full'
  | 'settings.chat.copy.option.text'
  | 'settings.chat.avatar.label'
  | 'settings.chat.avatar.option.default'
  | 'settings.chat.avatar.option.holycrab'
  | 'settings.chat.avatar.option.upload'
  | 'settings.chat.avatar.upload.button'
  | 'settings.chat.avatar.upload.clear'
  | 'settings.chat.avatar.upload.hint'
  | 'settings.chat.avatar.upload.ready'
  | 'settings.companion.title'
  | 'settings.companion.description'
  | 'settings.companion.enable.title'
  | 'settings.companion.enable.description'
  | 'settings.companion.provider.label'
  | 'settings.companion.provider.option.volcano'
  | 'settings.companion.provider.option.qwen'
  | 'settings.companion.model.label'
  | 'settings.companion.voice.label'
  | 'settings.companion.voice.volcano.cardTitle'
  | 'settings.companion.voice.volcano.cardHint'
  | 'settings.companion.voice.volcano.searchPlaceholder'
  | 'settings.companion.voice.volcano.noResult'
  | 'settings.companion.namespace.label'
  | 'settings.companion.endpoint.label'
  | 'settings.companion.apiKey.label'
  | 'settings.companion.appKey.label'
  | 'settings.companion.clearSavedApiKey'
  | 'settings.companion.clearSavedAppKey'
  | 'settings.companion.test.title'
  | 'settings.companion.test.description'
  | 'settings.companion.test.sample'
  | 'settings.companion.test.label'
  | 'settings.companion.test.play'
  | 'settings.companion.test.stop'
  | 'settings.companion.test.speaking'
  | 'settings.companion.test.testError'
  | 'settings.companion.test.error.kind.service'
  | 'settings.companion.test.error.kind.config'
  | 'settings.companion.test.error.kind.playback'
  | 'settings.companion.test.error.kind.unknown'
  | 'companion.live2d.title'
  | 'companion.live2d.description'
  | 'companion.live2d.upload.label'
  | 'companion.live2d.uploading'
  | 'companion.live2d.upload.button'
  | 'companion.live2d.upload.helper'
  | 'companion.live2d.models.title'
  | 'companion.live2d.models.loading'
  | 'companion.live2d.models.empty'
  | 'companion.live2d.models.uploaded'
  | 'companion.live2d.models.current'
  | 'companion.live2d.item.setActive'
  | 'companion.live2d.item.active'
  | 'companion.live2d.item.remove'
  | 'companion.live2d.item.removing'
  | 'companion.live2d.item.size'
  | 'companion.live2d.item.updated'
  | 'companion.live2d.preview.loading'
  | 'companion.live2d.preview.noModel'
  | 'companion.live2d.preview.preview'
  | 'companion.live2d.preview.failed'
  | 'companion.live2d.preview.failedToOpenFloatingWindow'
  | 'companion.page.toLabs'
  | 'companion.live2d.error.empty'
  | 'companion.live2d.error.uploadFailed'
  | 'companion.live2d.error.removeFailed'
  | 'companion.live2d.error.setActiveFailed'
  | 'companion.live2d.error.unsupportedType'
  | 'companion.live2d.error.tooLarge'
  | 'companion.state.title'
  | 'companion.state.mode.idle'
  | 'companion.state.mode.thinking'
  | 'companion.state.mode.speaking'
  | 'companion.state.source'
  | 'companion.state.sourceUnknown'
  | 'companion.state.updated'
  | 'companion.state.updatedUnknown'
  | 'settings.keys.title'
  | 'settings.keys.description'
  | 'settings.keys.open'
  | 'settings.keys.openWizard'
  | 'settings.memory.title'
  | 'settings.memory.description'
  | 'settings.memory.backupNow'
  | 'settings.memory.restoreLatest'
  | 'settings.memory.refresh'
  | 'settings.memory.refreshing'
  | 'settings.memory.lastBackup'
  | 'settings.memory.lastRestore'
  | 'settings.memory.lastError'
  | 'settings.memory.statusLoading'
  | 'settings.memory.statusUnavailable'
  | 'settings.memory.dialog.backupTitle'
  | 'settings.memory.dialog.restoreTitle'
  | 'settings.memory.dialog.description'
  | 'settings.memory.dialog.cancel'
  | 'settings.memory.dialog.continue'
  | 'settings.memory.dialog.working'
  | 'settings.memory.passphrase.label'
  | 'settings.memory.passphrase.placeholder'
  | 'settings.memory.passphrase.show'
  | 'settings.memory.passphrase.hide'
  | 'discover.page.title'
  | 'discover.page.subtitle'
  | 'discover.tab.home'
  | 'discover.tab.community'
  | 'discover.hero.badge'
  | 'discover.hero.title'
  | 'discover.hero.description'
  | 'discover.hero.step1'
  | 'discover.hero.step2'
  | 'discover.hero.step3'
  | 'discover.status.openclaw.ready'
  | 'discover.status.openclaw.missing'
  | 'discover.status.provider.ready'
  | 'discover.status.provider.pending'
  | 'discover.button.installOpenclaw'
  | 'discover.button.continueWizard'
  | 'discover.button.openingWizard'
  | 'discover.button.startChat'
  | 'discover.button.openingChat'
  | 'discover.button.recheck'
  | 'discover.button.settings'
  | 'discover.recommended.title'
  | 'discover.recommended.cloud.title'
  | 'discover.recommended.cloud.description'
  | 'discover.recommended.cloud.cta'
  | 'discover.recommended.api.title'
  | 'discover.recommended.api.description'
  | 'discover.recommended.api.cta'
  | 'discover.recommended.guide.title'
  | 'discover.recommended.guide.description'
  | 'discover.recommended.guide.cta'
  | 'discover.recommended.redeem.title'
  | 'discover.recommended.redeem.description'
  | 'discover.recommended.redeem.cta'
  | 'discover.recommended.telegram.title'
  | 'discover.recommended.telegram.description'
  | 'discover.recommended.telegram.cta'
  | 'discover.community.title'
  | 'discover.community.description'
  | 'discover.errors.gatewayNotReady'
  | 'setupWizard.page.title'
  | 'setupWizard.page.subtitle'
  | 'setupWizard.keys.cardTitle'
  | 'setupWizard.keys.blurb'
  | 'setupWizard.keys.status.ready'
  | 'setupWizard.keys.status.missing'
  | 'setupWizard.keys.button.openKeys'
  | 'setupWizard.field.provider'
  | 'setupWizard.field.model'
  | 'setupWizard.field.searchModels'
  | 'setupWizard.field.baseUrl'
  | 'setupWizard.field.apiKey'
  | 'setupWizard.field.show'
  | 'setupWizard.field.hide'
  | 'setupWizard.hint.pickModel'
  | 'setupWizard.hint.baseUrlDefault'
  | 'setupWizard.placeholder.baseUrl'
  | 'setupWizard.placeholder.apiKey'
  | 'setupWizard.button.saving'
  | 'setupWizard.button.save'
  | 'setupWizard.install.cardTitle'
  | 'setupWizard.channel.cardTitle'
  | 'setupWizard.step1.cardTitle'
  | 'setupWizard.step2.cardTitle'
  | 'setupWizard.step3.cardTitle'
  | 'setupWizard.step1.blurb'
  | 'setupWizard.step1.button.install'
  | 'setupWizard.step1.button.installing'
  | 'setupWizard.step1.button.retryInstall'
  | 'setupWizard.step1.hint.liveOutput'
  | 'setupWizard.step1.troubleshooting'
  | 'setupWizard.step1.button.refreshDetection'
  | 'setupWizard.step1.button.viewRuntimeSession'
  | 'setupWizard.step1.hint.sessionPanel'
  | 'setupWizard.step2.blurb'
  | 'setupWizard.step2.mode.existing'
  | 'setupWizard.step2.mode.new'
  | 'setupWizard.step2.button.switchMode'
  | 'setupWizard.step2.selectedProfile.title'
  | 'setupWizard.step2.selectedProfile.active'
  | 'setupWizard.step2.selectedProfile.none'
  | 'setupWizard.step2.button.useProfile'
  | 'setupWizard.step2.button.applying'
  | 'setupWizard.step2.noProfileFound'
  | 'setupWizard.step2.changeProfile'
  | 'setupWizard.step2.profileSelect.label'
  | 'setupWizard.step2.profileSelect.activeSuffix'
  | 'setupWizard.step2.profileSelect.hint'
  | 'setupWizard.step2.addNewInstead'
  | 'setupWizard.step2.button.switchToAddNew'
  | 'setupWizard.step2.provider.title'
  | 'setupWizard.step2.providerType.label'
  | 'setupWizard.step2.changeProvider'
  | 'setupWizard.step2.optionalProfileName'
  | 'setupWizard.step2.profileName.placeholder'
  | 'setupWizard.step2.baseUrl.placeholder'
  | 'setupWizard.step2.apiKey.placeholder'
  | 'setupWizard.step2.model.placeholder'
  | 'setupWizard.step2.button.saveProfile'
  | 'setupWizard.step2.button.saving'
  | 'setupWizard.step2.useExistingInstead'
  | 'setupWizard.step2.button.switchToExisting'
  | 'setupWizard.step3.blurb'
  | 'setupWizard.step3.channel.title'
  | 'setupWizard.step3.channel.label'
  | 'setupWizard.step3.changeChannel'
  | 'setupWizard.step3.status.telegram.checking'
  | 'setupWizard.step3.status.telegram.configured'
  | 'setupWizard.step3.status.telegram.exists'
  | 'setupWizard.step3.status.telegram.missing'
  | 'setupWizard.step3.status.feishu.checking'
  | 'setupWizard.step3.status.feishu.configured'
  | 'setupWizard.step3.status.feishu.exists'
  | 'setupWizard.step3.status.feishu.missing'
  | 'setupWizard.step3.status.discord.checking'
  | 'setupWizard.step3.status.discord.configured'
  | 'setupWizard.step3.status.discord.exists'
  | 'setupWizard.step3.status.discord.missing'
  | 'setupWizard.step3.button.settingUp'
  | 'setupWizard.step3.button.setup.telegram'
  | 'setupWizard.step3.button.setup.feishu'
  | 'setupWizard.step3.button.setup.discord'
  | 'setupWizard.step3.button.opening'
  | 'setupWizard.step3.button.startChat'
  | 'setupWizard.step3.otherActions'
  | 'setupWizard.errors.baseUrlRequired'
  | 'setupWizard.errors.modelRequired'
  | 'setupWizard.errors.apiKeyRequired'
  | 'setupWizard.errors.completeStepsBeforeChannel'
  | 'setupWizard.errors.gatewayNotReadyAfterInstall'
  | 'setupWizard.errors.gatewayNotReady'
  | 'setupWizard.errors.openclawInstalledButNotOnPath'
  | 'setupWizard.errors.tipOpenTerminalRun'
  | 'setupWizard.advice.installGatewayRestart'
  | 'setupWizard.advice.gatewayRestart'
  | 'setupWizard.advice.logsPrefix'
  | 'setupWizard.messages.providerProfileSelectedActive'
  | 'setupWizard.messages.providerProfileAlreadyActive'
  | 'setupWizard.messages.newProviderProfileSavedActive'
  | 'setupWizard.messages.openclawInstalled'
  | 'setupWizard.messages.openclawInstalledGatewaySecured'
  | 'setupWizard.messages.openclawInstalledGatewaySecuredReady'
  | 'setupWizard.messages.openclawInstalledGatewayReady'
  | 'setupWizard.messages.openclawChatOpened'
  | 'setupWizard.session.actionLabel.installUpgrade'
  | 'keys.page.title'
  | 'keys.page.subtitle'
  | 'keys.page.openMarketplace'
  | 'keys.page.backToWizard'
  | 'keys.page.whatIsThis.title'
  | 'keys.page.whatIsThis.p1'
  | 'keys.page.whatIsThis.p2'
  | 'keys.manager.title'
  | 'keys.manager.description'
  | 'keys.manager.newProfile'
  | 'keys.manager.active'
  | 'keys.fields.profileName'
  | 'keys.fields.profileNamePlaceholder'
  | 'keys.fields.provider'
  | 'keys.fields.baseUrl'
  | 'keys.fields.headers'
  | 'keys.fields.authHeader'
  | 'keys.fields.inputCapabilities'
  | 'keys.fields.inputText'
  | 'keys.fields.inputImage'
  | 'keys.fields.apiKey'
  | 'keys.fields.apiKeyPlaceholder'
  | 'keys.fields.model'
  | 'keys.fields.searchPlaceholder'
  | 'keys.fields.setActiveOnSave'
  | 'keys.sections.profiles'
  | 'keys.sections.details'
  | 'keys.actions.show'
  | 'keys.actions.hide'
  | 'keys.actions.copy'
  | 'keys.actions.copied'
  | 'keys.actions.verify'
  | 'keys.actions.verifying'
  | 'keys.actions.save'
  | 'keys.actions.saving'
  | 'keys.actions.saveSetActive'
  | 'keys.actions.setActive'
  | 'keys.actions.edit'
  | 'keys.actions.delete'
  | 'keys.actions.deleting'
  | 'keys.actions.more'
  | 'keys.actions.pick'
  | 'keys.actions.showAdvanced'
  | 'keys.actions.hideAdvanced'
  | 'keys.delete.title'
  | 'keys.delete.description'
  | 'keys.delete.cancel'
  | 'keys.delete.confirm'
  | 'keys.errors.baseUrlRequired'
  | 'keys.errors.headersJsonInvalid'
  | 'keys.errors.modelRequired'
  | 'keys.errors.apiKeyRequired'
  | 'keys.messages.verifyOk'
  | 'keys.messages.verifyFailed'
  | 'keys.messages.saved'
  | 'keys.messages.savedSetActive'
  | 'keys.messages.saveFailed'
  | 'keys.messages.setActiveOk'
  | 'keys.messages.setActiveFailed'
  | 'keys.messages.deleted'
  | 'keys.messages.deleteFailed'
  | 'keys.hint.authHeader'
  | 'link.page.title'
  | 'link.page.subtitle'
  | 'logs.page.title'
  | 'logs.page.clear'
  | 'logs.page.noLogs'
  | 'logs.page.refreshAriaLabel'
  | 'softwareCenter.page.title'
  | 'softwareCenter.page.subtitle'
  | 'softwareCenter.refresh'
  | 'softwareCenter.checkingUpdates'
  | 'softwareCenter.checkUpdates'
  | 'softwareCenter.runtimeSession'
  | 'softwareCenter.hideSession'
  | 'softwareCenter.showSession'
  | 'softwareCenter.error.runtimeDetectionFailed'
  | 'softwareCenter.error.openRuntimeFailed'
  | 'softwareCenter.status.checking'
  | 'softwareCenter.status.installed'
  | 'softwareCenter.status.missing'
  | 'softwareCenter.field.command'
  | 'softwareCenter.field.version'
  | 'softwareCenter.field.version.detecting'
  | 'softwareCenter.field.version.unavailable'
  | 'softwareCenter.field.entry'
  | 'softwareCenter.button.installing'
  | 'softwareCenter.button.opening'
  | 'softwareCenter.button.installCli'
  | 'softwareCenter.button.openApp'
  | 'softwareCenter.button.upgrade'
  | 'softwareCenter.button.upgradeTo'
  | 'softwareCenter.button.uninstall'
  | 'softwareCenter.button.preparing'
  | 'softwareCenter.button.openClawOnly'
  | 'softwareCenter.message.noUpdates'
  | 'softwareCenter.message.workanyDownloadOpened'
  | 'softwareCenter.message.updateCheckFailed'
  | 'softwareCenter.message.installFailed'
  | 'softwareCenter.message.upgradeFailed'
  | 'softwareCenter.message.uninstallFailed'
  | 'softwareCenter.message.commandFailedTip'
  | 'softwareCenter.message.onlyOpenClawUninstall'
  | 'softwareCenter.message.gatewayNotReady'
  | 'softwareCenter.message.gatewayStartingFallback'
  | 'softwareCenter.message.gatewayRunning'
  | 'softwareCenter.message.openclawInstalledStillFound'
  | 'softwareCenter.message.updateAvailable'
  | 'softwareCenter.message.remoteActionInvalid'
  | 'softwareCenter.message.remoteActionOpened'
  | 'softwareCenter.message.commandFailed'
  | 'softwareCenter.message.onlyOpenClawSupported'
  | 'softwareCenter.message.restartGatewayFailed'
  | 'softwareCenter.prefetch.background'
  | 'softwareCenter.badge.new'
  | 'softwareCenter.button.restartGateway'
  | 'softwareCenter.button.restartingGateway'
  | 'softwareCenter.button.webDashboard'
  | 'softwareCenter.button.openChat'
  | 'softwareCenter.button.reloadConfig'
  | 'softwareCenter.button.saveChanges'
  | 'softwareCenter.button.savingChanges'
  | 'softwareCenter.error.overviewLoadFailed'
  | 'softwareCenter.overview.loading'
  | 'softwareCenter.overview.auto'
  | 'softwareCenter.overview.notDetected'
  | 'softwareCenter.overview.gatewayAccess.title'
  | 'softwareCenter.overview.gatewayAccess.subtitle'
  | 'softwareCenter.overview.checks.title'
  | 'softwareCenter.overview.checks.subtitle'
  | 'softwareCenter.overview.snapshot.title'
  | 'softwareCenter.overview.snapshot.subtitle'
  | 'softwareCenter.overview.field.websocketUrl'
  | 'softwareCenter.overview.field.gatewayToken'
  | 'softwareCenter.overview.field.sessionKey'
  | 'softwareCenter.overview.field.language'
  | 'softwareCenter.overview.field.status'
  | 'softwareCenter.overview.field.gatewayProcess'
  | 'softwareCenter.overview.field.port'
  | 'softwareCenter.overview.field.chatReachability'
  | 'softwareCenter.overview.field.channelsReady'
  | 'softwareCenter.overview.field.providerAuth'
  | 'softwareCenter.overview.field.runtimeChecks'
  | 'softwareCenter.overview.field.agent'
  | 'softwareCenter.overview.field.workspace'
  | 'softwareCenter.overview.field.skills'
  | 'softwareCenter.overview.field.primaryModel'
  | 'softwareCenter.overview.status.online'
  | 'softwareCenter.overview.status.offline'
  | 'softwareCenter.overview.status.running'
  | 'softwareCenter.overview.status.stopped'
  | 'softwareCenter.overview.status.listening'
  | 'softwareCenter.overview.status.notListening'
  | 'softwareCenter.overview.status.reachable'
  | 'softwareCenter.overview.status.unreachable'
  | 'softwareCenter.overview.status.ready'
  | 'softwareCenter.overview.status.missing'
  | 'softwareCenter.overview.providerAuthHint'
  | 'softwareCenter.overview.runtimeChecksHint'
  | 'softwareCenter.overview.token.hide'
  | 'softwareCenter.overview.token.show'
  | 'softwareCenter.overview.agent.title'
  | 'softwareCenter.overview.agent.subtitle'
  | 'softwareCenter.overview.agent.defaultSuffix'
  | 'softwareCenter.overview.agent.currentPrefix'
  | 'softwareCenter.overview.agent.noConfiguredModels'
  | 'softwareCenter.overview.agent.group.keyHub'
  | 'softwareCenter.overview.agent.group.openclawSettings'
  | 'softwareCenter.overview.value.defaultWorkspace'
  | 'softwareCenter.overview.value.allSkills'
  | 'softwareCenter.overview.installOverlay.title'
  | 'softwareCenter.overview.installOverlay.description'
  | 'softwareCenter.overview.installOverlay.installing'
  | 'softwareCenter.overview.installOverlay.install'
  | 'softwareCenter.section.checks.title'
  | 'softwareCenter.section.checks.subtitle'
  | 'softwareCenter.section.agent.title'
  | 'softwareCenter.section.agent.subtitle'
  | 'softwareCenter.section.gateway.title'
  | 'softwareCenter.section.gateway.subtitle'
  | 'softwareCenter.section.layout.display'
  | 'softwareCenter.section.layout.actions'
  | 'softwareCenter.section.actions.recheck'
  | 'chat.page.title'
  | 'chat.page.subtitle'
  | 'chat.status.checking'
  | 'chat.status.connected'
  | 'chat.status.disconnected'
  | 'chat.mask.title'
  | 'chat.mask.description'
  | 'chat.mask.openWizard'
  | 'chat.mask.retryGateway'
  | 'chat.history.loading'
  | 'chat.history.empty'
  | 'chat.tips.button'
  | 'chat.tips.title'
  | 'chat.scrollToBottom'
  | 'chat.input.placeholder.ready'
  | 'chat.input.placeholder.disabled'
  | 'chat.input.send'
  | 'chat.input.queue'
  | 'chat.input.sending'
  | 'chat.input.busyRunning'
  | 'chat.input.busyQueuePrefix'
  | 'chat.input.markdownHint'
  | 'chat.input.expand'
  | 'chat.input.collapse'
  | 'chat.input.dictationProcessing'
  | 'chat.suggestion.note.title'
  | 'chat.suggestion.note.prompt'
  | 'chat.suggestion.note.body'
  | 'chat.suggestion.workflow.title'
  | 'chat.suggestion.workflow.prompt'
  | 'chat.suggestion.workflow.body'
  | 'chat.suggestion.key.badge'
  | 'chat.suggestion.key.title'
  | 'chat.suggestion.key.body'
  | 'chat.suggestion.key.highlight1'
  | 'chat.suggestion.key.highlight2'
  | 'chat.suggestion.key.cta'
  | 'chat.suggestion.dashboard.badge'
  | 'chat.suggestion.dashboard.title'
  | 'chat.suggestion.dashboard.body'
  | 'chat.suggestion.dashboard.highlight1'
  | 'chat.suggestion.dashboard.highlight2'
  | 'chat.suggestion.dashboard.cta'
  | 'chat.suggestion.insight.badge'
  | 'chat.suggestion.insight.title'
  | 'chat.suggestion.insight.prompt'
  | 'chat.suggestion.insight.body'
  | 'chat.suggestion.insight.highlight1'
  | 'chat.suggestion.insight.highlight2'
  | 'chat.suggestion.insight.ctaTry'
  | 'chat.suggestion.insight.ctaMore'
  | 'nav.chat'
  | 'nav.community'
  | 'nav.discover'
  | 'nav.softwareCenter'
  | 'nav.keys'
  | 'nav.tts'
  | 'nav.channels'
  | 'nav.settings'
  | 'nav.logs'
  | 'tts.page.title'
  | 'tts.page.subtitle'
  | 'channels.page.title'
  | 'channels.page.subtitle'
  | 'channels.list.title'
  | 'channels.list.subtitle'
  | 'channels.list.empty'
  | 'channels.form.title'
  | 'channels.form.subtitle'
  | 'channels.form.channelId'
  | 'channels.form.status'
  | 'channels.form.configJson'
  | 'channels.form.commonFields.title'
  | 'channels.form.commonFields.subtitle'
  | 'channels.form.commonFields.empty'
  | 'channels.form.advanced.title'
  | 'channels.form.advanced.subtitle'
  | 'channels.form.advanced.invalidJson'
  | 'channels.form.advanced.requireObject'
  | 'channels.form.whatsappHint'
  | 'channels.status.configured'
  | 'channels.status.notConfigured'
  | 'channels.actions.save'
  | 'channels.actions.saving'
  | 'channels.actions.test'
  | 'channels.actions.testing'
  | 'channels.actions.clear'
  | 'channels.actions.clearing'
  | 'channels.actions.whatsappLogin'
  | 'channels.actions.whatsappLoggingIn'
  | 'channels.actions.askAi'
  | 'channels.actions.clearConfirm'
  | 'channels.feedback.loadFailed'
  | 'channels.feedback.saveSuccess'
  | 'channels.feedback.testSuccess'
  | 'channels.feedback.clearSuccess'
  | 'channels.feedback.loginStarted'
  | 'channels.feedback.loginInstructions'
  | 'channels.feedback.loginSuccess'
  | 'channels.feedback.loginTimeout'
  | 'theme.lightMode'
  | 'theme.darkMode'
  | 'keys.hint.searchModels'
  | 'keys.hint.pickOrTypeModel'
  | 'keys.hint.baseUrlDefault'
  | 'keys.error.providerLoadFailed'
  | 'keys.placeholder.model'
  | 'keys.placeholder.baseUrl'
  | 'runtime.defaultLabel'
  | 'settings.security.title'
  | 'settings.security.description'
  | 'settings.security.button.run'
  | 'settings.security.button.running'
  | 'settings.security.label.port'
  | 'settings.security.label.listener'
  | 'settings.security.label.listening'
  | 'settings.security.label.notListening'
  | 'settings.security.label.binding'
  | 'settings.security.status.loopbackOnly'
  | 'settings.security.status.allInterfaces'
  | 'settings.security.status.nonLoopback'
  | 'settings.security.status.notListening'
  | 'settings.security.status.unknown'
  | 'settings.security.button.fix'
  | 'settings.security.button.fixing'
  | 'settings.security.fix.setDescription'
  | 'settings.security.label.openclawHooksUrl'
  | 'settings.security.label.listeningAddresses'
  | 'settings.security.label.fix'
  | 'settings.security.status.succeeded'
  | 'settings.security.status.failed'
  | 'settings.security.fixResult.configUpdated'
  | 'settings.security.fixResult.noConfigChange'
  | 'settings.security.fixResult.restarted'
  | 'settings.security.fixResult.notRestarted'
  | 'settings.security.label.config'
  | 'settings.status.title'
  | 'settings.status.deviceId'
  | 'settings.status.authenticated'
  | 'settings.status.yes'
  | 'settings.status.no'
  | 'settings.status.daemonRpcToken'
  | 'settings.status.set'
  | 'settings.status.unset'
  | 'settings.status.openclawUrl'
  | 'settings.status.openclawHooksToken'
  | 'settings.status.openclawWsToken'
  | 'settings.status.tenantUrl'
  | 'discover.errors.logsPrefix'
  | 'discover.hero.prevSlide'
  | 'discover.hero.nextSlide'
  | 'setupWizard.status.checkingSavedProviderSetup'
  | 'setupWizard.mode.existing'
  | 'setupWizard.mode.createNew'
  | 'setupWizard.existingKey.title'
  | 'setupWizard.button.createNewKey'
  | 'setupWizard.button.useAndContinue'
  | 'setupWizard.button.next'
  | 'setupWizard.step3.button.skipStartChat'
  | 'setupWizard.telegram.title'
  | 'setupWizard.telegram.howToGetToken'
  | 'setupWizard.telegram.guide.step1Prefix'
  | 'setupWizard.telegram.guide.step1Suffix'
  | 'setupWizard.telegram.guide.step2'
  | 'setupWizard.telegram.guide.step3'
  | 'setupWizard.telegram.guide.step4'
  | 'setupWizard.telegram.guide.step5'
  | 'setupWizard.telegram.label.botToken'
  | 'setupWizard.telegram.placeholder.botToken'
  | 'setupWizard.telegram.button.saving'
  | 'setupWizard.telegram.button.saveConnect'
  | 'setupWizard.telegram.videoHintPrefix'
  | 'setupWizard.telegram.videoHintSuffix'
  | 'setupWizard.messages.saved'
  | 'setupWizard.errors.openclawAuthProfilesNotReady'
  | 'setupWizard.errors.existingProfileRequired'
  | 'setupWizard.errors.telegramTokenRequired'
  | 'setupWizard.errors.telegramTokenInvalidFormat'
  | 'setupWizard.messages.usingExistingKeyProfile'
  | 'setupWizard.errors.installFailedPrefix'
  | 'setupWizard.errors.installFailedSuffix'
  | 'locale.switch.chinese'
  | 'locale.switch.english'
  | 'locale.switch.chineseShort'
  | 'locale.switch.englishShort'
  | 'settings.updates.appleDoubleHint'
  | 'settings.updates.appleDoubleAction'
  | 'settings.memory.error.statusFailedPrefix'
  | 'settings.memory.error.passphraseRequired'
  | 'settings.memory.message.backupCompleted'
  | 'settings.memory.message.restoreCompleted'
  | 'settings.memory.comingSoonSuffix'
  | 'settings.comingSoon'
  | 'settings.security.label.detection'
  | 'settings.daemon.title'
  | 'settings.daemon.controlPlaneUrl'
  | 'settings.daemon.gatewayUrl'
  | 'settings.daemon.rpcAddress'
  | 'settings.daemon.rpcAddressPlaceholder'
  | 'settings.daemon.rpcAddressHint'
  | 'settings.daemon.rpcToken'
  | 'settings.daemon.tokenPlaceholderSet'
  | 'settings.daemon.tokenPlaceholderPaste'
  | 'settings.daemon.clearSavedToken'
  | 'settings.daemon.openclawHooksUrl'
  | 'settings.daemon.openclawHooksUrlPlaceholder'
  | 'settings.daemon.openclawHooksUrlHint'
  | 'settings.daemon.openclawHooksToken'
  | 'settings.daemon.openclawWsToken'
  | 'settings.daemon.wsTokenHint'
  | 'settings.daemon.save'
  | 'settings.daemon.saving'
  | 'settings.daemon.status.applied'
  | 'settings.daemon.status.noChanges'
  | 'settings.daemon.status.pairingReset'
  | 'settings.daemon.status.restartRequired'
  | 'redeem.page.title'
  | 'redeem.input.placeholder'
  | 'redeem.button.claim'
  | 'redeem.button.claiming'
  | 'redeem.button.saveClose'
  | 'redeem.button.saving'
  | 'redeem.labels.provider'
  | 'redeem.labels.model'
  | 'redeem.labels.baseUrl'
  | 'redeem.labels.apiKey'
  | 'redeem.messages.saved'
  | 'redeem.errors.emptyModel'
  | 'redeem.errors.emptyApiKey'
  | 'redeem.errors.resourceMissing'
  | 'redeem.errors.resourceInvalidJson'
  | 'redeem.errors.resourceInvalidFormat'
  | 'redeem.errors.generic'
  | 'redeem.errors.noData'
  | 'redeem.errors.codeRequired'
  | 'redeem.errors.serviceUnavailable'
  | 'redeem.errors.httpPrefix'
  | 'redeem.errors.responseInvalidPrefix'
  | 'redeem.errors.responseInvalidSuffix'
  | 'redeem.errors.responseEmpty'

const translations: Record<Locale, Record<TranslationKey, string>> = {
  en: {
    'common.refresh': 'Refresh',
    'common.checking': 'Checking…',
    'runtimeSession.title': 'Runtime Session',
    'runtimeSession.status.idle': 'Idle',
    'runtimeSession.status.running': 'Running',
    'runtimeSession.status.success': 'Success',
    'runtimeSession.status.failed': 'Failed',
    'runtimeSession.detail.idle': 'No runtime action yet.',
    'runtimeSession.detail.running': 'Streaming command output…',
    'runtimeSession.detail.success': 'Command finished.',
    'runtimeSession.detail.failed': 'Command failed.',
    'runtimeSession.detail.ptyRunning': 'Interactive terminal session…',
    'runtimeSession.action.upgrade': 'Upgrade',
    'runtimeSession.action.uninstall': 'Uninstall',
    'runtimeSession.action.install': 'Install',
    'runtimeSession.action.open': 'Open',
    'runtimeSession.action.fallback': 'Action',
    'runtimeSession.button.close': 'Close',
    'runtimeSession.terminal.waiting': '$ waiting for output…',
    'settings.updates.title': 'Updates',
    'settings.updates.description':
      'Check for HolyCrab updates, pre-download in the background, then install and relaunch.',
    'settings.updates.currentVersion': 'Current version',
    'settings.updates.availableVersion': 'Available version',
    'settings.updates.check': 'Check for updates',
    'settings.updates.checking': 'Checking…',
    'settings.updates.installRestart': 'Install & relaunch',
    'settings.updates.installing': 'Installing…',
    'settings.updates.clear': 'Clear update cache',
    'settings.updates.noUpdates': 'No updates available.',
    'settings.updates.error': 'Update error',
    'settings.updates.status': 'Status',
    'settings.updates.status.available': 'available',
    'settings.updates.status.downloading': 'downloading',
    'settings.updates.status.downloaded': 'downloaded',
    'settings.updates.downloaded': 'Download',
    'updates.oneClick.label': 'Update',
    'updates.oneClick.title': 'Update HolyCrab',
    'updates.oneClick.subtitle': 'Downloads the update, installs it, then relaunches.',
    'updates.oneClick.status.checking': 'Checking…',
    'updates.oneClick.status.downloading': 'Downloading…',
    'updates.oneClick.status.installing': 'Installing & relaunching…',
    'updates.oneClick.close': 'Close',
    'settings.language.title': 'Language',
    'settings.language.description': 'Switch application language for onboarding copy.',
    'settings.language.current': 'Current language',
    'settings.language.english': 'English',
    'settings.language.chinese': '简体中文',
    'settings.dictation.title': 'Dictation',
    'settings.dictation.description': 'Enable microphone dictation with on-device transcription.',
    'settings.dictation.enable.title': 'Enable dictation',
    'settings.dictation.enable.description': 'Downloads the selected Whisper model on first use.',
    'settings.dictation.model.label': 'Dictation model',
    'settings.dictation.model.downloadSize': 'Download size',
    'settings.dictation.model.note.tiny': 'Fastest, least accurate.',
    'settings.dictation.model.note.base': 'Balanced default.',
    'settings.dictation.model.note.small': 'Better accuracy.',
    'settings.dictation.model.note.medium': 'High accuracy.',
    'settings.dictation.model.note.largeV3': 'Best accuracy, heavy download.',
    'settings.dictation.language.label': 'Preferred dictation language',
    'settings.dictation.language.help':
      'Auto-detect stays on; this nudges the decoder toward your preference.',
    'settings.dictation.language.option.auto': 'Auto-detect only',
    'settings.dictation.language.option.english': 'English',
    'settings.dictation.language.option.spanish': 'Spanish',
    'settings.dictation.language.option.french': 'French',
    'settings.dictation.language.option.german': 'German',
    'settings.dictation.language.option.italian': 'Italian',
    'settings.dictation.language.option.portuguese': 'Portuguese',
    'settings.dictation.language.option.dutch': 'Dutch',
    'settings.dictation.language.option.swedish': 'Swedish',
    'settings.dictation.language.option.norwegian': 'Norwegian',
    'settings.dictation.language.option.danish': 'Danish',
    'settings.dictation.language.option.finnish': 'Finnish',
    'settings.dictation.language.option.polish': 'Polish',
    'settings.dictation.language.option.turkish': 'Turkish',
    'settings.dictation.language.option.russian': 'Russian',
    'settings.dictation.language.option.ukrainian': 'Ukrainian',
    'settings.dictation.language.option.japanese': 'Japanese',
    'settings.dictation.language.option.korean': 'Korean',
    'settings.dictation.language.option.chinese': 'Chinese',
    'settings.dictation.holdKey.label': 'Hold-to-dictate key',
    'settings.dictation.holdKey.off': 'Off',
    'settings.dictation.holdKey.option': 'Option',
    'settings.dictation.holdKey.alt': 'Alt',
    'settings.dictation.holdKey.command': 'Command',
    'settings.dictation.holdKey.windows': 'Windows',
    'settings.dictation.holdKey.meta': 'Meta',
    'settings.dictation.holdKey.shift': 'Shift',
    'settings.dictation.holdKey.control': 'Control',
    'settings.dictation.holdKey.help': 'Hold the key to start dictation, release to stop and process.',
    'settings.dictation.status.title': 'Model status',
    'settings.dictation.status.ready': 'Ready for dictation.',
    'settings.dictation.status.missing': 'Model not downloaded yet.',
    'settings.dictation.status.downloading': 'Downloading model…',
    'settings.dictation.status.errorFallback': 'Download error.',
    'settings.dictation.status.loading': 'Loading model status…',
    'settings.dictation.status.unavailable': 'Model status unavailable.',
    'settings.dictation.status.requestError': 'Status request failed',
    'settings.dictation.actions.download': 'Download model',
    'settings.dictation.actions.downloading': 'Downloading…',
    'settings.dictation.actions.cancel': 'Cancel download',
    'settings.dictation.actions.canceling': 'Canceling…',
    'settings.dictation.actions.remove': 'Remove model',
    'settings.dictation.actions.removing': 'Removing…',
    'settings.chat.title': 'Chat',
    'settings.chat.description': 'Configure how chat messages are displayed, copied, and how bot avatar appears.',
    'settings.chat.display.label': 'Display mode',
    'settings.chat.display.option.collapsed': 'Collapsed (tool calls hidden, only show working status)',
    'settings.chat.display.option.contentOnly': 'Content only (text messages only)',
    'settings.chat.display.option.full': 'Full view (current complete format)',
    'settings.chat.copy.label': 'Copy message as',
    'settings.chat.copy.option.markdown': 'Markdown format',
    'settings.chat.copy.option.full': 'Complete content',
    'settings.chat.copy.option.text': 'Plain text only',
    'settings.chat.avatar.label': 'Bot avatar',
    'settings.chat.avatar.option.default': 'Default',
    'settings.chat.avatar.option.holycrab': 'HolyCrab',
    'settings.chat.avatar.option.upload': 'User uploaded',
    'settings.chat.avatar.upload.button': 'Upload avatar',
    'settings.chat.avatar.upload.clear': 'Clear upload',
    'settings.chat.avatar.upload.hint': 'Upload an image file for custom bot avatar.',
    'settings.chat.avatar.upload.ready': 'Uploaded avatar is ready.',
    'settings.companion.title': 'Live2D Companion',
    'settings.companion.description': 'Configure voice provider settings for the desktop companion and validate speech playback.',
    'settings.companion.enable.title': 'Enable companion speech',
    'settings.companion.enable.description': 'When enabled, chat output can be rendered as synchronized companion speech.',
    'settings.companion.provider.label': 'TTS provider',
    'settings.companion.provider.option.volcano': 'Volcano',
    'settings.companion.provider.option.qwen': 'Qwen-TTS',
    'settings.companion.model.label': 'Model',
    'settings.companion.voice.label': 'Voice',
    'settings.companion.voice.volcano.cardTitle': 'Volcano voice library',
    'settings.companion.voice.volcano.cardHint': 'Search by name or voice_type',
    'settings.companion.voice.volcano.searchPlaceholder': 'Search voice name / voice_type',
    'settings.companion.voice.volcano.noResult': 'No matching voice, keep manual input.',
    'settings.companion.namespace.label': 'Namespace',
    'settings.companion.endpoint.label': 'Endpoint',
    'settings.companion.apiKey.label': 'Access token',
    'settings.companion.appKey.label': 'AppID',
    'settings.companion.clearSavedApiKey': 'Clear saved Access token',
    'settings.companion.clearSavedAppKey': 'Clear saved AppID',
    'settings.companion.test.title': 'Companion speech test',
    'settings.companion.test.description': 'Play a sample sentence to verify endpoint and mouth-sync pipeline.',
    'settings.companion.test.sample': 'Hello, this is a test sentence for the desktop companion.',
    'settings.companion.test.label': 'Speech sample',
    'settings.companion.test.play': 'Play sample',
    'settings.companion.test.stop': 'Stop',
    'settings.companion.test.speaking': 'Speaking…',
    'settings.companion.test.testError': 'Test failed',
    'settings.companion.test.error.kind.service': 'Service unavailable',
    'settings.companion.test.error.kind.config': 'Configuration issue',
    'settings.companion.test.error.kind.playback': 'Playback issue',
    'settings.companion.test.error.kind.unknown': 'Unknown issue',
    'companion.live2d.title': 'Live2D Models',
    'companion.live2d.description': 'Upload, activate, and manage local Live2D model files for the desktop companion.',
    'companion.live2d.upload.label': 'Live2D model file',
    'companion.live2d.uploading': 'Uploading...',
    'companion.live2d.upload.button': 'Upload model',
    'companion.live2d.upload.helper': 'Upload zip or model bundle files. Model becomes active after upload.',
    'companion.live2d.models.title': 'Model library',
    'companion.live2d.models.loading': 'Loading model library...',
    'companion.live2d.models.empty': 'No model uploaded yet.',
    'companion.live2d.models.uploaded': 'Uploaded',
    'companion.live2d.models.current': 'Current model',
    'companion.live2d.item.setActive': 'Set active',
    'companion.live2d.item.active': 'Active',
    'companion.live2d.item.remove': 'Delete',
    'companion.live2d.item.removing': 'Deleting...',
    'companion.live2d.item.size': 'Size',
    'companion.live2d.item.updated': 'Updated',
    'companion.live2d.preview.loading': 'Loading live2d model...',
    'companion.live2d.preview.noModel': 'No active model selected.',
    'companion.live2d.preview.preview': 'Live2D preview',
    'companion.live2d.preview.failed': 'Live2D preview failed',
    'companion.live2d.preview.failedToOpenFloatingWindow': 'Failed to open floating window.',
    'companion.page.toLabs': 'Back to labs',
    'companion.live2d.error.empty': 'Please choose a model file first.',
    'companion.live2d.error.uploadFailed': 'Upload failed',
    'companion.live2d.error.removeFailed': 'Delete failed',
    'companion.live2d.error.setActiveFailed': 'Activate failed',
    'companion.live2d.error.unsupportedType': 'Unsupported model type.',
    'companion.live2d.error.tooLarge': 'File too large',
    'companion.state.title': 'Companion action',
    'companion.state.mode.idle': 'Idle',
    'companion.state.mode.thinking': 'Thinking',
    'companion.state.mode.speaking': 'Speaking',
    'companion.state.source': 'Source',
    'companion.state.sourceUnknown': 'Unknown',
    'companion.state.updated': 'Updated',
    'companion.state.updatedUnknown': 'Not started',
    'settings.keys.title': 'Keys',
    'settings.keys.description': 'Manage provider API keys and presets. Setup Wizard will use keys saved here.',
    'settings.keys.open': 'Open Keys',
    'settings.keys.openWizard': 'Open Setup Wizard',
    'settings.memory.title': 'Memory Sync',
    'settings.memory.description':
      'Backup and restore your local memory to sync across devices. Passphrase is never stored.',
    'settings.memory.backupNow': 'Backup now',
    'settings.memory.restoreLatest': 'Restore latest',
    'settings.memory.refresh': 'Refresh',
    'settings.memory.refreshing': 'Refreshing…',
    'settings.memory.lastBackup': 'Last backup',
    'settings.memory.lastRestore': 'Last restore',
    'settings.memory.lastError': 'Last error',
    'settings.memory.statusLoading': 'Loading status…',
    'settings.memory.statusUnavailable': 'Status unavailable.',
    'settings.memory.dialog.backupTitle': 'Backup memory now',
    'settings.memory.dialog.restoreTitle': 'Restore latest memory',
    'settings.memory.dialog.description':
      'Enter your passphrase to encrypt/decrypt your memory snapshot. This passphrase is never stored.',
    'settings.memory.dialog.cancel': 'Cancel',
    'settings.memory.dialog.continue': 'Continue',
    'settings.memory.dialog.working': 'Working…',
    'settings.memory.passphrase.label': 'Passphrase',
    'settings.memory.passphrase.placeholder': 'Enter passphrase',
    'settings.memory.passphrase.show': 'Show',
    'settings.memory.passphrase.hide': 'Hide',
    'discover.page.title': 'Discover',
    'discover.page.subtitle': 'Explore OpenClaw community resources, templates, and practical skill packs.',
    'discover.tab.home': 'Home',
    'discover.tab.community': 'Community',
    'discover.hero.badge': 'Step 1',
    'discover.hero.title': 'Start by setting up OpenClaw',
    'discover.hero.description': 'Install OpenClaw first, then continue provider and channel setup.',
    'discover.hero.step1': '1. Install OpenClaw',
    'discover.hero.step2': '2. Configure Provider',
    'discover.hero.step3': '3. Connect Channel',
    'discover.status.openclaw.ready': 'OpenClaw Ready',
    'discover.status.openclaw.missing': 'OpenClaw Missing',
    'discover.status.provider.ready': 'Provider Ready',
    'discover.status.provider.pending': 'Provider Pending',
    'discover.button.installOpenclaw': 'Install OpenClaw',
    'discover.button.continueWizard': 'Continue in Setup Wizard',
    'discover.button.openingWizard': 'Opening Wizard…',
    'discover.button.startChat': 'Start Chat',
    'discover.button.openingChat': 'Opening Chat…',
    'discover.button.recheck': 'Re-check',
    'discover.button.settings': 'Settings',
    'discover.recommended.title': 'Recommended',
    'discover.recommended.cloud.title': 'Cloud OpenClaw',
    'discover.recommended.cloud.description': 'Deploy a managed OpenClaw runtime in the cloud with guided setup.',
    'discover.recommended.cloud.cta': 'Explore Cloud',
    'discover.recommended.api.title': 'API Deals',
    'discover.recommended.api.description': 'Find discounted model providers and prefilled BYOK profiles.',
    'discover.recommended.api.cta': 'View API Offers',
    'discover.recommended.guide.title': 'Beginner Guides',
    'discover.recommended.guide.description': 'Step-by-step tutorials for non-developers.',
    'discover.recommended.guide.cta': 'Open Guides',
    'discover.recommended.redeem.title': 'Redeem Box',
    'discover.recommended.redeem.description': 'Claim a promo key and save it directly to your local profiles.',
    'discover.recommended.redeem.cta': 'Open Redeem Box',
    'discover.recommended.telegram.title': 'Connect OpenClaw To Telegram',
    'discover.recommended.telegram.description':
      'Connect your Telegram bot in under a minute. The OpenClaw will guide you through smartly.',
    'discover.recommended.telegram.cta': 'Connect Telegram',
    'discover.community.title': 'Community',
    'discover.community.description':
      'Coming soon. Beginner tutorials and practical guides will be published here.',
    'discover.errors.gatewayNotReady': 'OpenClaw gateway is not ready yet.',
    'setupWizard.page.title': 'Setup Wizard',
    'setupWizard.page.subtitle': 'Add your key first, then install OpenClaw.',
    'setupWizard.keys.cardTitle': 'Step 1 · Keys',
    'setupWizard.keys.blurb':
      'Bots like OpenClaw need a provider key. Save one key profile and set it active to continue.',
    'setupWizard.keys.status.ready': 'Key is ready.',
    'setupWizard.keys.status.missing': 'No usable key found yet. Add a key profile first.',
    'setupWizard.keys.button.openKeys': 'Open Keys',
    'setupWizard.field.provider': 'Provider',
    'setupWizard.field.model': 'Model',
    'setupWizard.field.searchModels': 'Search models...',
    'setupWizard.field.baseUrl': 'Base URL',
    'setupWizard.field.apiKey': 'API key',
    'setupWizard.field.show': 'Show',
    'setupWizard.field.hide': 'Hide',
    'setupWizard.hint.pickModel': 'Pick from the list, or type any model.',
    'setupWizard.hint.baseUrlDefault': 'Most providers don\'t need Base URL changes.',
    'setupWizard.placeholder.baseUrl': 'https://api.openai.com/v1',
    'setupWizard.placeholder.apiKey': 'Paste API key',
    'setupWizard.button.saving': 'Saving…',
    'setupWizard.button.save': 'Save',
    'setupWizard.install.cardTitle': 'Step 2 · Install OpenClaw',
    'setupWizard.channel.cardTitle': 'Step 3 · Connect Channel',
    'setupWizard.step1.cardTitle': 'Step 1 · Install OpenClaw',
    'setupWizard.step2.cardTitle': 'Step 2 · Configure Provider',
    'setupWizard.step3.cardTitle': 'Step 3 · Connect Channel',
    'setupWizard.step1.blurb': 'OpenClaw powers the local gateway and chat UI. Install it to continue.',
    'setupWizard.step1.button.install': 'Install OpenClaw',
    'setupWizard.step1.button.installing': 'Installing…',
    'setupWizard.step1.button.retryInstall': 'Retry Install OpenClaw',
    'setupWizard.step1.hint.liveOutput': 'Live output is shown in the Runtime Session panel.',
    'setupWizard.step1.troubleshooting': 'Troubleshooting',
    'setupWizard.step1.button.refreshDetection': 'Refresh Detection',
    'setupWizard.step1.button.viewRuntimeSession': 'View Runtime Session',
    'setupWizard.step1.hint.sessionPanel': 'If install looks stuck, open the session panel to review output.',
    'setupWizard.step2.blurb': 'Set the provider OpenClaw should use. We only highlight the next step.',
    'setupWizard.step2.mode.existing': 'Using existing profile',
    'setupWizard.step2.mode.new': 'Adding new profile',
    'setupWizard.step2.button.switchMode': 'Switch',
    'setupWizard.step2.selectedProfile.title': 'Selected profile',
    'setupWizard.step2.selectedProfile.active': 'Active',
    'setupWizard.step2.selectedProfile.none': 'Select a profile to continue.',
    'setupWizard.step2.button.useProfile': 'Use This Profile',
    'setupWizard.step2.button.applying': 'Applying…',
    'setupWizard.step2.noProfileFound': 'No profiles found yet. Use “Switch” to add one.',
    'setupWizard.step2.changeProfile': 'Change profile',
    'setupWizard.step2.profileSelect.label': 'Provider profile',
    'setupWizard.step2.profileSelect.activeSuffix': ' (active)',
    'setupWizard.step2.profileSelect.hint': 'This does not apply changes until you click “Use This Profile”.',
    'setupWizard.step2.addNewInstead': 'Add a new provider instead',
    'setupWizard.step2.button.switchToAddNew': 'Switch to Add New',
    'setupWizard.step2.provider.title': 'Provider',
    'setupWizard.step2.providerType.label': 'Provider type',
    'setupWizard.step2.changeProvider': 'Change provider',
    'setupWizard.step2.optionalProfileName': 'Optional: profile name',
    'setupWizard.step2.profileName.placeholder': 'Profile name (optional)',
    'setupWizard.step2.baseUrl.placeholder': 'https://api.openai.com/v1',
    'setupWizard.step2.apiKey.placeholder': 'Paste API key',
    'setupWizard.step2.model.placeholder': 'provider/model',
    'setupWizard.step2.button.saveProfile': 'Save Profile',
    'setupWizard.step2.button.saving': 'Saving…',
    'setupWizard.step2.useExistingInstead': 'Use an existing profile instead',
    'setupWizard.step2.button.switchToExisting': 'Switch to Existing',
    'setupWizard.step3.blurb': 'Start a local chat, or connect a channel to talk to OpenClaw from your apps.',
    'setupWizard.step3.channel.title': 'Channel',
    'setupWizard.step3.channel.label': 'Channel',
    'setupWizard.step3.changeChannel': 'Change channel',
    'setupWizard.step3.status.telegram.checking': 'Checking OpenClaw JSON for Telegram settings…',
    'setupWizard.step3.status.telegram.configured': 'Telegram is already configured in OpenClaw JSON.',
    'setupWizard.step3.status.telegram.exists': 'Telegram section exists, but key/secret is still missing in OpenClaw JSON.',
    'setupWizard.step3.status.telegram.missing': 'Telegram is not configured in OpenClaw JSON yet.',
    'setupWizard.step3.status.feishu.checking': 'Checking OpenClaw JSON for Feishu settings…',
    'setupWizard.step3.status.feishu.configured': 'Feishu is already configured in OpenClaw JSON.',
    'setupWizard.step3.status.feishu.exists': 'Feishu section exists, but key/secret is still missing in OpenClaw JSON.',
    'setupWizard.step3.status.feishu.missing': 'Feishu is not configured in OpenClaw JSON yet.',
    'setupWizard.step3.status.discord.checking': 'Checking OpenClaw JSON for Discord settings…',
    'setupWizard.step3.status.discord.configured': 'Discord is already configured in OpenClaw JSON.',
    'setupWizard.step3.status.discord.exists': 'Discord section exists, but key/secret is still missing in OpenClaw JSON.',
    'setupWizard.step3.status.discord.missing': 'Discord is not configured in OpenClaw JSON yet.',
    'setupWizard.step3.button.settingUp': 'Setting up…',
    'setupWizard.step3.button.setup.telegram': 'Setup Telegram',
    'setupWizard.step3.button.setup.feishu': 'Setup Feishu',
    'setupWizard.step3.button.setup.discord': 'Setup Discord',
    'setupWizard.step3.button.opening': 'Opening…',
    'setupWizard.step3.button.startChat': 'Start Chat',
    'setupWizard.step3.otherActions': 'Other actions',
    'setupWizard.errors.baseUrlRequired': 'Base URL is required.',
    'setupWizard.errors.modelRequired': 'Model is required.',
    'setupWizard.errors.apiKeyRequired': 'API key is required.',
    'setupWizard.errors.completeStepsBeforeChannel': 'Complete keys and install OpenClaw before channel setup.',
    'setupWizard.errors.gatewayNotReadyAfterInstall': 'OpenClaw installed, but the gateway is not ready yet.',
    'setupWizard.errors.gatewayNotReady': 'OpenClaw gateway is not ready yet.',
    'setupWizard.errors.openclawInstalledButNotOnPath': 'OpenClaw installed, but openclaw is not on PATH in this shell yet.',
    'setupWizard.errors.tipOpenTerminalRun': 'Tip: open a Terminal and run: openclaw gateway install',
    'setupWizard.advice.installGatewayRestart': '- Try running: openclaw gateway install && openclaw gateway restart',
    'setupWizard.advice.gatewayRestart': '- Try running: openclaw gateway restart',
    'setupWizard.advice.logsPrefix': '- Logs:',
    'setupWizard.messages.providerProfileSelectedActive': 'Provider profile selected and active.',
    'setupWizard.messages.providerProfileAlreadyActive': 'Provider profile already active.',
    'setupWizard.messages.newProviderProfileSavedActive': 'New provider profile saved and set active.',
    'setupWizard.messages.openclawInstalled': 'OpenClaw installed.',
    'setupWizard.messages.openclawInstalledGatewaySecured': 'OpenClaw installed. Gateway secured to loopback.',
    'setupWizard.messages.openclawInstalledGatewaySecuredReady': 'OpenClaw installed. Gateway secured to loopback and ready.',
    'setupWizard.messages.openclawInstalledGatewayReady': 'OpenClaw installed. Gateway is ready.',
    'setupWizard.messages.openclawChatOpened': 'OpenClaw chat opened.',
    'setupWizard.session.actionLabel.installUpgrade': 'Install / Upgrade',

    'keys.page.title': 'Key Hub',
    'keys.page.subtitle': 'Your models run on keys. Save, verify, and reuse them.',
    'keys.page.openMarketplace': 'Open Key Marketplace',
    'keys.page.backToWizard': 'Back to Setup Wizard',
    'keys.page.whatIsThis.title': 'What is this?',
    'keys.page.whatIsThis.p1': 'Bots like OpenClaw, Codex, and Claude Code need a provider key to run.',
    'keys.page.whatIsThis.p2': 'Save multiple presets and switch the active one without retyping.',

    'keys.manager.title': 'Key Manager',
    'keys.manager.description': 'Create provider presets, verify them, then set one as active.',
    'keys.manager.newProfile': 'New profile',
    'keys.manager.active': 'Active',
    'keys.fields.profileName': 'Profile name',
    'keys.fields.profileNamePlaceholder': 'My OpenAI',
    'keys.fields.provider': 'Provider',
    'keys.fields.baseUrl': 'Base URL',
    'keys.fields.headers': 'Headers (JSON)',
    'keys.fields.authHeader': 'Use auth header',
    'keys.fields.inputCapabilities': 'Input capabilities',
    'keys.fields.inputText': 'Text',
    'keys.fields.inputImage': 'Image',
    'keys.fields.apiKey': 'API key',
    'keys.fields.apiKeyPlaceholder': 'Paste API key',
    'keys.fields.model': 'Model',
    'keys.fields.searchPlaceholder': 'Search profiles…',
    'keys.fields.setActiveOnSave': 'Set as active on save',
    'keys.sections.profiles': 'Profiles',
    'keys.sections.details': 'Details',
    'keys.actions.show': 'Show',
    'keys.actions.hide': 'Hide',
    'keys.actions.copy': 'Copy',
    'keys.actions.copied': 'Copied',
    'keys.actions.verify': 'Verify',
    'keys.actions.verifying': 'Verifying…',
    'keys.actions.save': 'Save',
    'keys.actions.saving': 'Saving…',
    'keys.actions.saveSetActive': 'Save & set active',
    'keys.actions.setActive': 'Set active',
    'keys.actions.edit': 'Edit',
    'keys.actions.delete': 'Delete',
    'keys.actions.deleting': 'Deleting…',
    'keys.actions.more': 'More',
    'keys.actions.pick': 'Pick',
    'keys.actions.showAdvanced': 'Advanced',
    'keys.actions.hideAdvanced': 'Advanced',
    'keys.delete.title': 'Delete key profile?',
    'keys.delete.description': 'This removes the saved profile from this device.',
    'keys.delete.cancel': 'Cancel',
    'keys.delete.confirm': 'Delete',
    'keys.errors.baseUrlRequired': 'Base URL is required.',
    'keys.errors.headersJsonInvalid': 'Headers must be a valid JSON object.',
    'keys.errors.modelRequired': 'Model is required.',
    'keys.errors.apiKeyRequired': 'API key is required.',
    'keys.messages.verifyOk': 'Verified.',
    'keys.messages.verifyFailed': 'Verify failed',
    'keys.messages.saved': 'Saved.',
    'keys.messages.savedSetActive': 'Saved and set active.',
    'keys.messages.saveFailed': 'Save failed',
    'keys.messages.setActiveOk': 'Active key updated.',
    'keys.messages.setActiveFailed': 'Set active failed',
    'keys.messages.deleted': 'Deleted.',
    'keys.messages.deleteFailed': 'Delete failed',
    'keys.hint.authHeader': 'Enable when provider expects API key in Authorization header.',

    'link.page.title': 'Link',
    'link.page.subtitle': 'Handling a deep link and routing you to the right page…',

    'logs.page.title': 'Daemon Logs',
    'logs.page.clear': 'Clear',
    'logs.page.noLogs': 'No logs yet.',
    'logs.page.refreshAriaLabel': 'Refresh',

    'softwareCenter.page.title': 'Dashboard',
    'softwareCenter.page.subtitle': 'Install, upgrade, uninstall, and open OpenClaw with one focused control panel.',
    'softwareCenter.refresh': 'Refresh',
    'softwareCenter.checkingUpdates': 'Checking updates…',
    'softwareCenter.checkUpdates': 'Check updates',
    'softwareCenter.runtimeSession': 'Runtime session',
    'softwareCenter.hideSession': 'Hide session',
    'softwareCenter.showSession': 'Show session',
    'softwareCenter.error.runtimeDetectionFailed': 'Runtime detection failed:',
    'softwareCenter.error.openRuntimeFailed': 'Open runtime failed:',
    'softwareCenter.status.checking': 'Checking…',
    'softwareCenter.status.installed': 'Installed',
    'softwareCenter.status.missing': 'Missing',
    'softwareCenter.field.command': 'Command:',
    'softwareCenter.field.version': 'Version:',
    'softwareCenter.field.version.detecting': 'Detecting…',
    'softwareCenter.field.version.unavailable': 'Unavailable',
    'softwareCenter.field.entry': 'Entry:',
    'softwareCenter.button.installing': 'Installing…',
    'softwareCenter.button.opening': 'Opening…',
    'softwareCenter.button.installCli': 'Install CLI',
    'softwareCenter.button.openApp': 'Open App',
    'softwareCenter.button.upgrade': 'Upgrade',
    'softwareCenter.button.upgradeTo': 'Upgrade →',
    'softwareCenter.button.uninstall': 'Uninstall',
    'softwareCenter.button.preparing': 'Preparing…',
    'softwareCenter.button.openClawOnly': 'OpenClaw only',
    'softwareCenter.message.noUpdates': 'No runtime updates found.',
    'softwareCenter.message.workanyDownloadOpened': 'Opened WorkAny download:',
    'softwareCenter.message.updateCheckFailed': 'Update check failed:',
    'softwareCenter.message.installFailed': 'Install failed:',
    'softwareCenter.message.upgradeFailed': 'Upgrade failed:',
    'softwareCenter.message.uninstallFailed': 'Uninstall failed:',
    'softwareCenter.message.commandFailedTip': 'Tip: use "Open Terminal" and run the command manually.',
    'softwareCenter.message.onlyOpenClawUninstall': 'Only OpenClaw uninstall is enabled.',
    'softwareCenter.message.gatewayNotReady': 'OpenClaw installed/updated, but the gateway is not ready yet.',
    'softwareCenter.message.gatewayStartingFallback': 'Gateway not detected yet. Starting fallback gateway (background)...',
    'softwareCenter.message.gatewayRunning': 'Gateway running.',
    'softwareCenter.message.openclawInstalledStillFound': 'Uninstall finished, but openclaw is still found. Another install may exist.',
    'softwareCenter.message.updateAvailable': 'OpenClaw installed, but openclaw is not available in this shell PATH.',
    'softwareCenter.message.remoteActionInvalid': 'Invalid remote action for',
    'softwareCenter.message.remoteActionOpened': 'opened remote action',
    'softwareCenter.message.commandFailed': 'Command failed',
    'softwareCenter.message.onlyOpenClawSupported': 'Only OpenClaw is supported.',
    'softwareCenter.message.restartGatewayFailed': 'Restart Gateway failed:',
    'softwareCenter.prefetch.background': '(background)',
    'softwareCenter.badge.new': 'New',
    'softwareCenter.button.restartGateway': 'Restart Gateway',
    'softwareCenter.button.restartingGateway': 'Restarting…',
    'softwareCenter.button.webDashboard': 'Web Dashboard',
    'softwareCenter.button.openChat': 'Open Chat',
    'softwareCenter.button.reloadConfig': 'Reload Config',
    'softwareCenter.button.saveChanges': 'Save Changes',
    'softwareCenter.button.savingChanges': 'Saving…',
    'softwareCenter.error.overviewLoadFailed': 'Failed to load overview snapshot:',
    'softwareCenter.overview.loading': 'Loading...',
    'softwareCenter.overview.auto': 'auto',
    'softwareCenter.overview.notDetected': 'Not detected',
    'softwareCenter.overview.gatewayAccess.title': 'Gateway Access',
    'softwareCenter.overview.gatewayAccess.subtitle': 'Dashboard endpoint and auth readiness.',
    'softwareCenter.overview.checks.title': 'Checks',
    'softwareCenter.overview.checks.subtitle': 'Review agent settings together with channel, auth, and runtime checks.',
    'softwareCenter.overview.snapshot.title': 'Snapshot',
    'softwareCenter.overview.snapshot.subtitle': 'Gateway handshake and live health checks.',
    'softwareCenter.overview.field.websocketUrl': 'WebSocket URL',
    'softwareCenter.overview.field.gatewayToken': 'Gateway Token',
    'softwareCenter.overview.field.sessionKey': 'Session Key',
    'softwareCenter.overview.field.language': 'Language',
    'softwareCenter.overview.field.status': 'Status',
    'softwareCenter.overview.field.gatewayProcess': 'Gateway Process',
    'softwareCenter.overview.field.port': 'Port',
    'softwareCenter.overview.field.chatReachability': 'Chat Reachability',
    'softwareCenter.overview.field.channelsReady': 'Channels Ready',
    'softwareCenter.overview.field.providerAuth': 'Provider Auth',
    'softwareCenter.overview.field.runtimeChecks': 'Runtime Checks',
    'softwareCenter.overview.field.agent': 'Agent',
    'softwareCenter.overview.field.workspace': 'Workspace',
    'softwareCenter.overview.field.skills': 'Skills',
    'softwareCenter.overview.field.primaryModel': 'Primary Model',
    'softwareCenter.overview.status.online': 'Online',
    'softwareCenter.overview.status.offline': 'Offline',
    'softwareCenter.overview.status.running': 'Running',
    'softwareCenter.overview.status.stopped': 'Stopped',
    'softwareCenter.overview.status.listening': 'Listening',
    'softwareCenter.overview.status.notListening': 'Not Listening',
    'softwareCenter.overview.status.reachable': 'Reachable',
    'softwareCenter.overview.status.unreachable': 'Unreachable',
    'softwareCenter.overview.status.ready': 'Ready',
    'softwareCenter.overview.status.missing': 'Missing',
    'softwareCenter.overview.providerAuthHint': 'auth-profiles state',
    'softwareCenter.overview.runtimeChecksHint': 'health gates passed',
    'softwareCenter.overview.token.hide': 'Hide token',
    'softwareCenter.overview.token.show': 'Show token',
    'softwareCenter.overview.agent.title': 'Agent Review',
    'softwareCenter.overview.agent.subtitle': 'Select an agent to view model configuration summary.',
    'softwareCenter.overview.agent.defaultSuffix': '(default)',
    'softwareCenter.overview.agent.currentPrefix': 'Current',
    'softwareCenter.overview.agent.noConfiguredModels': 'No configured models',
    'softwareCenter.overview.agent.group.keyHub': 'Key Hub',
    'softwareCenter.overview.agent.group.openclawSettings': 'OpenClaw settings',
    'softwareCenter.overview.value.defaultWorkspace': 'default',
    'softwareCenter.overview.value.allSkills': 'all skills',
    'softwareCenter.overview.installOverlay.title': 'OpenClaw runtime not detected',
    'softwareCenter.overview.installOverlay.description': 'Install OpenClaw first. The overview cards will show live status once installation completes.',
    'softwareCenter.overview.installOverlay.installing': 'Installing OpenClaw…',
    'softwareCenter.overview.installOverlay.install': 'Install OpenClaw',
    'softwareCenter.section.checks.title': 'Checks',
    'softwareCenter.section.checks.subtitle': 'Security checks, channel readiness, and provider auth status.',
    'softwareCenter.section.agent.title': 'Agent Settings',
    'softwareCenter.section.agent.subtitle': 'Choose agent and update the primary model.',
    'softwareCenter.section.gateway.title': 'Gateway Health & Settings',
    'softwareCenter.section.gateway.subtitle': 'Gateway connection, token, endpoint, and runtime health.',
    'softwareCenter.section.layout.display': 'Display',
    'softwareCenter.section.layout.actions': 'Actions',
    'softwareCenter.section.actions.recheck': 'Re-check',

    'chat.page.title': 'Chat',
    'chat.page.subtitle': 'Talk with the OpenClaw main agent directly from HolyCrab.',
    'chat.status.checking': 'Checking OpenClaw status…',
    'chat.status.connected': 'Gateway connected',
    'chat.status.disconnected': 'Gateway disconnected',
    'chat.mask.title': 'OpenClaw is not ready yet',
    'chat.mask.description': 'Complete Setup Wizard first, and OpenClaw Agent will be ready to chat with you.',
    'chat.mask.openWizard': 'Open Setup Wizard',
    'chat.mask.retryGateway': 'Retry Gateway',
    'chat.history.loading': 'Loading conversation…',
    'chat.history.empty': 'No messages yet. Start a new conversation.',
    'chat.tips.button': 'Tips',
    'chat.tips.title': 'Tips',
    'chat.scrollToBottom': 'Scroll to bottom',
    'chat.input.placeholder.ready': 'Message OpenClaw (Shift+Enter for line breaks, paste images supported)…',
    'chat.input.placeholder.disabled': 'Complete Setup Wizard first, then come back to chat.',
    'chat.input.send': 'Send',
    'chat.input.queue': 'Queue',
    'chat.input.sending': 'Sending…',
    'chat.input.busyRunning': 'AI is responding… you can keep typing and tap Queue.',
    'chat.input.busyQueuePrefix': 'Queued messages: ',
    'chat.input.markdownHint': 'Markdown enabled',
    'chat.input.expand': 'Expand',
    'chat.input.collapse': 'Collapse',
    'chat.input.dictationProcessing': 'Processing dictation…',
    'chat.suggestion.note.title': 'Task Notes',
    'chat.suggestion.note.prompt': 'Create a new note titled Today’s Tasks and list the top three priorities with clear next steps.',
    'chat.suggestion.note.body': 'Generate a concise daily task note and actionable checklist.',
    'chat.suggestion.workflow.title': 'Workflow Safety Check',
    'chat.suggestion.workflow.prompt': 'Review my current workflow and list the top five operational risks with mitigation steps.',
    'chat.suggestion.workflow.body': 'Analyze workflow risks and provide practical mitigation advice.',
    'chat.suggestion.key.badge': 'Upgrade',
    'chat.suggestion.key.title': 'OpenClaw not smart enough? Try a stronger, more capable model.',
    'chat.suggestion.key.body': 'Higher-quality models can significantly improve task understanding, tool usage, and complex reasoning.',
    'chat.suggestion.key.highlight1': 'Recommended smarter models',
    'chat.suggestion.key.highlight2': 'One-click special offer',
    'chat.suggestion.key.cta': 'View special offer',
    'chat.suggestion.dashboard.badge': 'Control',
    'chat.suggestion.dashboard.title': 'Where is OpenClaw status? Gateway, Agent, and security are all in Dashboard.',
    'chat.suggestion.dashboard.body': 'Review Gateway, Agent, auth, and health checks in one place to troubleshoot faster.',
    'chat.suggestion.dashboard.highlight1': 'Gateway + Agent',
    'chat.suggestion.dashboard.highlight2': 'Security + Health checks',
    'chat.suggestion.dashboard.cta': 'Open Dashboard',
    'chat.suggestion.insight.badge': 'Playbook',
    'chat.suggestion.insight.title': 'Quick Market Insight',
    'chat.suggestion.insight.prompt': 'Give me a concise BTC and ETH market snapshot with risk notes for the next 24 hours.',
    'chat.suggestion.insight.body': 'Make OpenClaw your intelligent analyst. Start quickly with one practical example.',
    'chat.suggestion.insight.highlight1': 'Structured output template',
    'chat.suggestion.insight.highlight2': '24h risk briefing',
    'chat.suggestion.insight.ctaTry': 'Try now',
    'chat.suggestion.insight.ctaMore': 'More examples',

    'nav.chat': 'Chat',
    'nav.community': 'Community',
    'nav.discover': 'Discover',
    'nav.softwareCenter': 'Dashboard',
    'nav.keys': 'Key Hub',
    'nav.tts': 'Voice Models',
    'nav.channels': 'Channels',
    'nav.settings': 'Settings',
    'nav.logs': 'Logs',

    'tts.page.title': 'Voice Models',
    'tts.page.subtitle': 'Configure and test voice models.',

    'channels.page.title': 'Channels',
    'channels.page.subtitle': 'Manage OpenClaw channel configs, run tests, and trigger WhatsApp login.',
    'channels.list.title': 'Channel List',
    'channels.list.subtitle': 'Pick a channel to edit or test.',
    'channels.list.empty': 'No channels returned by daemon.',
    'channels.form.title': 'Channel Config',
    'channels.form.subtitle': 'Edit JSON config and apply actions to the selected channel.',
    'channels.form.channelId': 'Channel ID',
    'channels.form.status': 'Status',
    'channels.form.configJson': 'Config JSON',
    'channels.form.commonFields.title': 'Common Fields',
    'channels.form.commonFields.subtitle': 'Edit common channel fields first, then use Advanced JSON for custom keys.',
    'channels.form.commonFields.empty': 'No preset fields for this channel yet. Use Advanced JSON below.',
    'channels.form.advanced.title': 'Advanced JSON',
    'channels.form.advanced.subtitle': 'Keeps unknown or custom fields without loss.',
    'channels.form.advanced.invalidJson': 'Advanced JSON parse failed. Please check format.',
    'channels.form.advanced.requireObject': 'Advanced JSON must be an object.',
    'channels.form.whatsappHint': 'WhatsApp login starts a local device-link flow in daemon.',
    'channels.status.configured': 'Configured',
    'channels.status.notConfigured': 'Not configured',
    'channels.actions.save': 'Save',
    'channels.actions.saving': 'Saving…',
    'channels.actions.test': 'Test',
    'channels.actions.testing': 'Testing…',
    'channels.actions.clear': 'Clear',
    'channels.actions.clearing': 'Clearing…',
    'channels.actions.whatsappLogin': 'WhatsApp Login',
    'channels.actions.whatsappLoggingIn': 'Starting WhatsApp Login…',
    'channels.actions.askAi': 'Ask AI',
    'channels.actions.clearConfirm': 'Clear this channel config now?',
    'channels.feedback.loadFailed': 'Failed to load channels',
    'channels.feedback.saveSuccess': 'Channel config saved.',
    'channels.feedback.testSuccess': 'Channel test started.',
    'channels.feedback.clearSuccess': 'Channel config cleared.',
    'channels.feedback.loginStarted': 'WhatsApp login started.',
    'channels.feedback.loginInstructions': 'Please scan the QR code in the opened terminal window.',
    'channels.feedback.loginSuccess': 'WhatsApp login succeeded.',
    'channels.feedback.loginTimeout': 'WhatsApp login status check timed out. Scan and retry if needed.',

    'theme.lightMode': 'Light Mode',
    'theme.darkMode': 'Dark Mode',

    'keys.hint.searchModels': 'Search models...',
    'keys.hint.pickOrTypeModel': 'Pick a suggestion or type your own.',
    'keys.hint.baseUrlDefault': 'Most providers don\'t need Base URL changes.',
    'keys.error.providerLoadFailed': 'Provider load failed:',
    'keys.placeholder.model': 'model',
    'keys.placeholder.baseUrl': 'https://api.openai.com/v1',

    'runtime.defaultLabel': 'OpenClaw',

    'settings.security.title': 'Security Check',
    'settings.security.description': 'Checks whether OpenClaw\'s inbound port is listening and whether it is bound to loopback vs network interfaces. If socket inspection fails, binding will show as Unknown.',
    'settings.security.button.run': 'Run check',
    'settings.security.button.running': 'Running…',
    'settings.security.label.port': 'Port',
    'settings.security.label.listener': 'Listener',
    'settings.security.label.listening': 'Listening',
    'settings.security.label.notListening': 'Not listening',
    'settings.security.label.binding': 'Binding',
    'settings.security.status.loopbackOnly': 'Loopback only (127.0.0.1 / ::1)',
    'settings.security.status.allInterfaces': 'Exposed to all interfaces (0.0.0.0 / ::)',
    'settings.security.status.nonLoopback': 'Exposed on a network interface',
    'settings.security.status.notListening': 'Not listening',
    'settings.security.status.unknown': 'Unknown (could not inspect sockets)',
    'settings.security.button.fix': 'Fix & restart OpenClaw',
    'settings.security.button.fixing': 'Fixing…',
    'settings.security.fix.setDescription': 'Sets gateway.bind=loopback and restarts the gateway (local-only).',
    'settings.security.label.openclawHooksUrl': 'OpenClaw Hooks URL',
    'settings.security.label.listeningAddresses': 'Listening addresses',
    'settings.security.label.fix': 'Fix',
    'settings.security.status.succeeded': 'Succeeded',
    'settings.security.status.failed': 'Failed',
    'settings.security.fixResult.configUpdated': '(config updated)',
    'settings.security.fixResult.noConfigChange': '(no config change)',
    'settings.security.fixResult.restarted': ', restarted',
    'settings.security.fixResult.notRestarted': ', not restarted',
    'settings.security.label.config': 'Config',

    'discover.errors.logsPrefix': '- Logs:',
    'discover.hero.nextSlide': 'Next slide',
    'discover.hero.prevSlide': 'Previous slide',
    'locale.switch.chinese': 'Chinese',
    'locale.switch.chineseShort': '中',
    'locale.switch.english': 'English',
    'locale.switch.englishShort': 'EN',
    'redeem.page.title': 'Redeem Gift Key',
    'redeem.input.placeholder': 'Enter redeem code',
    'redeem.button.claim': 'Claim',
    'redeem.button.claiming': 'Claiming…',
    'redeem.button.saveClose': 'Save & close',
    'redeem.button.saving': 'Saving…',
    'redeem.labels.provider': 'Provider',
    'redeem.labels.model': 'Model',
    'redeem.labels.baseUrl': 'Base URL',
    'redeem.labels.apiKey': 'API key',
    'redeem.messages.saved': 'Saved: ',
    'redeem.errors.generic': 'Redeem failed',
    'redeem.errors.emptyModel': 'Redeem failed: returned model is empty',
    'redeem.errors.emptyApiKey': 'Redeem failed: returned key is empty',
    'redeem.errors.resourceMissing': 'Redeem failed: data[0].resource is missing',
    'redeem.errors.resourceInvalidJson': 'Redeem failed: resource is not valid JSON',
    'redeem.errors.resourceInvalidFormat': 'Redeem failed: resource format is invalid',
    'redeem.errors.noData': 'Redeem failed: no available data[0]',
    'redeem.errors.codeRequired': 'Please enter redeem code',
    'redeem.errors.serviceUnavailable': 'Redeem failed: cannot reach redeem service',
    'redeem.errors.httpPrefix': 'Redeem failed: HTTP',
    'redeem.errors.responseInvalidPrefix': 'Redeem failed: invalid response format (',
    'redeem.errors.responseInvalidSuffix': ')',
    'redeem.errors.responseEmpty': 'Redeem failed: empty response',
    'settings.comingSoon': 'Coming soon.',
    'settings.memory.comingSoonSuffix': '(coming soon)',
    'settings.memory.error.passphraseRequired': 'Passphrase is required.',
    'settings.memory.error.statusFailedPrefix': 'Memory sync status failed:',
    'settings.memory.message.backupCompleted': 'Backup completed.',
    'settings.memory.message.restoreCompleted': 'Restore completed.',
    'settings.security.label.detection': 'Detection',
    'settings.updates.appleDoubleHint': 'This is usually caused by old update archives that include macOS AppleDouble files (`._*`).',
    'settings.updates.appleDoubleAction': 'Fixed: click “Check for updates” to re-download, then click “Install & relaunch”.',
    'setupWizard.button.createNewKey': 'Create new key',
    'setupWizard.button.next': 'Next',
    'setupWizard.button.useAndContinue': 'Use and continue',
    'setupWizard.errors.existingProfileRequired': 'Please select an existing profile first.',
    'setupWizard.errors.installFailedPrefix': 'Install failed (exit',
    'setupWizard.errors.installFailedSuffix': '). Tip: use “Open Terminal” and run the command manually.',
    'setupWizard.errors.openclawAuthProfilesNotReady': 'OpenClaw auth-profiles are not ready yet.',
    'setupWizard.errors.telegramTokenInvalidFormat': 'Telegram bot token format looks invalid. Expected format: 123456789:ABC...',
    'setupWizard.errors.telegramTokenRequired': 'Please paste a valid Telegram bot token from @BotFather.',
    'setupWizard.existingKey.title': 'Select existing key',
    'setupWizard.messages.saved': 'Saved.',
    'setupWizard.messages.usingExistingKeyProfile': 'Using existing key profile.',
    'setupWizard.mode.createNew': 'Create new',
    'setupWizard.mode.existing': 'Existing',
    'setupWizard.status.checkingSavedProviderSetup': 'Checking saved provider setup...',
    'setupWizard.step3.button.skipStartChat': 'Skip for now · Start Chat',
    'setupWizard.telegram.button.saveConnect': 'Save & Connect',
    'setupWizard.telegram.button.saving': 'Saving…',
    'setupWizard.telegram.guide.step1Prefix': 'Open Telegram and go to',
    'setupWizard.telegram.guide.step1Suffix': '.',
    'setupWizard.telegram.guide.step2': 'Start a chat and type',
    'setupWizard.telegram.guide.step3': 'Follow prompts to set bot name and username.',
    'setupWizard.telegram.guide.step4': 'BotFather sends your token. Copy the full token string.',
    'setupWizard.telegram.guide.step5': 'Paste token below, then click Save & Connect.',
    'setupWizard.telegram.howToGetToken': 'How to get your bot token?',
    'setupWizard.telegram.label.botToken': 'Enter bot token',
    'setupWizard.telegram.placeholder.botToken': '123456789:ABCdefGHIjkLMNOpqrSTUVWxyz',
    'setupWizard.telegram.title': 'Connect Telegram',
    'setupWizard.telegram.videoHintPrefix': 'Video tutorial. If playback fails, open',
    'setupWizard.telegram.videoHintSuffix': '.',
    'settings.daemon.title': 'Daemon',
    'settings.daemon.controlPlaneUrl': 'Control plane URL',
    'settings.daemon.gatewayUrl': 'Gateway URL',
    'settings.daemon.rpcAddress': 'RPC address',
    'settings.daemon.rpcAddressPlaceholder': '127.0.0.1:4455',
    'settings.daemon.rpcAddressHint': 'Host:port used by the app to connect to daemon RPC.',
    'settings.daemon.rpcToken': 'RPC token',
    'settings.daemon.tokenPlaceholderSet': 'Already set (leave empty to keep unchanged)',
    'settings.daemon.tokenPlaceholderPaste': 'Paste token',
    'settings.daemon.clearSavedToken': 'Clear saved token',
    'settings.daemon.openclawHooksUrl': 'OpenClaw Hooks URL',
    'settings.daemon.openclawHooksUrlPlaceholder': 'https://example.com/hooks',
    'settings.daemon.openclawHooksUrlHint': 'Used for OpenClaw webhook callbacks.',
    'settings.daemon.openclawHooksToken': 'OpenClaw Hooks token',
    'settings.daemon.openclawWsToken': 'OpenClaw WS token',
    'settings.daemon.wsTokenHint': 'WebSocket auth token used by OpenClaw gateway.',
    'settings.daemon.save': 'Save daemon settings',
    'settings.daemon.saving': 'Saving…',
    'settings.daemon.status.applied': 'Changes applied.',
    'settings.daemon.status.noChanges': 'No changes.',
    'settings.daemon.status.pairingReset': 'Pairing token reset.',
    'settings.daemon.status.restartRequired': 'Restart required.',
    'settings.status.title': 'Status',
    'settings.status.deviceId': 'Device ID',
    'settings.status.authenticated': 'Authenticated',
    'settings.status.yes': 'yes',
    'settings.status.no': 'no',
    'settings.status.daemonRpcToken': 'Daemon RPC token',
    'settings.status.set': 'set',
    'settings.status.unset': 'unset',
    'settings.status.openclawUrl': 'OpenClaw URL',
    'settings.status.openclawHooksToken': 'OpenClaw hooks token',
    'settings.status.openclawWsToken': 'OpenClaw WS token',
    'settings.status.tenantUrl': 'Tenant URL',
  },
  zh: {
    'common.refresh': '刷新',
    'common.checking': '检测中…',
    'runtimeSession.title': '运行会话',
    'runtimeSession.status.idle': '空闲',
    'runtimeSession.status.running': '运行中',
    'runtimeSession.status.success': '成功',
    'runtimeSession.status.failed': '失败',
    'runtimeSession.detail.idle': '尚未执行任何运行操作。',
    'runtimeSession.detail.running': '正在实时输出…',
    'runtimeSession.detail.success': '命令已完成。',
    'runtimeSession.detail.failed': '命令执行失败。',
    'runtimeSession.detail.ptyRunning': '交互式终端会话…',
    'runtimeSession.action.upgrade': '升级',
    'runtimeSession.action.uninstall': '卸载',
    'runtimeSession.action.install': '安装',
    'runtimeSession.action.open': '打开',
    'runtimeSession.action.fallback': '操作',
    'runtimeSession.button.close': '关闭',
    'runtimeSession.terminal.waiting': '$ 等待输出…',
    'settings.updates.title': '更新',
    'settings.updates.description': '检查 HolyCrab 更新，后台预下载，然后安装并重启。',
    'settings.updates.currentVersion': '当前版本',
    'settings.updates.availableVersion': '可用版本',
    'settings.updates.check': '检查更新',
    'settings.updates.checking': '检测中…',
    'settings.updates.installRestart': '安装并重启',
    'settings.updates.installing': '安装中…',
    'settings.updates.clear': '清理更新缓存',
    'settings.updates.noUpdates': '当前已是最新版本。',
    'settings.updates.error': '更新错误',
    'settings.updates.status': '状态',
    'settings.updates.status.available': '可用',
    'settings.updates.status.downloading': '下载中',
    'settings.updates.status.downloaded': '已下载',
    'settings.updates.downloaded': '下载',
    'updates.oneClick.label': '更新',
    'updates.oneClick.title': '更新 HolyCrab',
    'updates.oneClick.subtitle': '自动下载更新包，安装并重启。',
    'updates.oneClick.status.checking': '检查中…',
    'updates.oneClick.status.downloading': '下载中…',
    'updates.oneClick.status.installing': '安装并重启中…',
    'updates.oneClick.close': '关闭',
    'settings.language.title': '语言',
    'settings.language.description': '切换应用语言（主要影响引导与文案）。',
    'settings.language.current': '当前语言',
    'settings.language.english': 'English',
    'settings.language.chinese': '简体中文',
    'settings.dictation.title': '听写',
    'settings.dictation.description': '启用麦克风听写，使用本地模型转写语音。',
    'settings.dictation.enable.title': '启用听写',
    'settings.dictation.enable.description': '首次使用会下载你选择的 Whisper 模型。',
    'settings.dictation.model.label': '听写模型',
    'settings.dictation.model.downloadSize': '下载大小',
    'settings.dictation.model.note.tiny': '速度最快，准确率最低。',
    'settings.dictation.model.note.base': '默认平衡选项。',
    'settings.dictation.model.note.small': '准确率更好。',
    'settings.dictation.model.note.medium': '高准确率。',
    'settings.dictation.model.note.largeV3': '准确率最佳，下载体积较大。',
    'settings.dictation.language.label': '偏好听写语言',
    'settings.dictation.language.help': '自动识别仍会启用；该选项用于优先引导解码语言。',
    'settings.dictation.language.option.auto': '仅自动识别',
    'settings.dictation.language.option.english': '英语',
    'settings.dictation.language.option.spanish': '西班牙语',
    'settings.dictation.language.option.french': '法语',
    'settings.dictation.language.option.german': '德语',
    'settings.dictation.language.option.italian': '意大利语',
    'settings.dictation.language.option.portuguese': '葡萄牙语',
    'settings.dictation.language.option.dutch': '荷兰语',
    'settings.dictation.language.option.swedish': '瑞典语',
    'settings.dictation.language.option.norwegian': '挪威语',
    'settings.dictation.language.option.danish': '丹麦语',
    'settings.dictation.language.option.finnish': '芬兰语',
    'settings.dictation.language.option.polish': '波兰语',
    'settings.dictation.language.option.turkish': '土耳其语',
    'settings.dictation.language.option.russian': '俄语',
    'settings.dictation.language.option.ukrainian': '乌克兰语',
    'settings.dictation.language.option.japanese': '日语',
    'settings.dictation.language.option.korean': '韩语',
    'settings.dictation.language.option.chinese': '中文',
    'settings.dictation.holdKey.label': '按住说话快捷键',
    'settings.dictation.holdKey.off': '关闭',
    'settings.dictation.holdKey.option': 'Option',
    'settings.dictation.holdKey.alt': 'Alt',
    'settings.dictation.holdKey.command': 'Command',
    'settings.dictation.holdKey.windows': 'Windows',
    'settings.dictation.holdKey.meta': 'Meta',
    'settings.dictation.holdKey.shift': 'Shift',
    'settings.dictation.holdKey.control': 'Control',
    'settings.dictation.holdKey.help': '按住按键开始听写，松开后停止并处理结果。',
    'settings.dictation.status.title': '模型状态',
    'settings.dictation.status.ready': '模型已就绪，可开始听写。',
    'settings.dictation.status.missing': '模型尚未下载。',
    'settings.dictation.status.downloading': '模型下载中…',
    'settings.dictation.status.errorFallback': '模型下载失败。',
    'settings.dictation.status.loading': '正在加载模型状态…',
    'settings.dictation.status.unavailable': '当前无法获取模型状态。',
    'settings.dictation.status.requestError': '状态请求失败',
    'settings.dictation.actions.download': '下载模型',
    'settings.dictation.actions.downloading': '下载中…',
    'settings.dictation.actions.cancel': '取消下载',
    'settings.dictation.actions.canceling': '取消中…',
    'settings.dictation.actions.remove': '移除模型',
    'settings.dictation.actions.removing': '移除中…',
    'settings.chat.title': '聊天设置',
    'settings.chat.description': '配置聊天消息的展示方式、复制格式和 Bot 头像样式。',
    'settings.chat.display.label': '展示形式',
    'settings.chat.display.option.collapsed': '折叠式（隐藏 Tool Call，仅显示思考中）',
    'settings.chat.display.option.contentOnly': '仅内容（仅显示文本消息）',
    'settings.chat.display.option.full': '完整展示（当前完整格式）',
    'settings.chat.copy.label': '消息复制',
    'settings.chat.copy.option.markdown': 'MarkDown 格式',
    'settings.chat.copy.option.full': '完整内容',
    'settings.chat.copy.option.text': '仅文本',
    'settings.chat.avatar.label': 'Bot 头像',
    'settings.chat.avatar.option.default': '默认',
    'settings.chat.avatar.option.holycrab': 'HolyCrab',
    'settings.chat.avatar.option.upload': '用户上传',
    'settings.chat.avatar.upload.button': '上传头像',
    'settings.chat.avatar.upload.clear': '清除上传',
    'settings.chat.avatar.upload.hint': '上传图片文件作为自定义 Bot 头像。',
    'settings.chat.avatar.upload.ready': '头像已上传，可用于用户上传模式。',
    'settings.companion.title': '桌面伴侣',
    'settings.companion.description': '配置桌面伴侣的语音参数，用于语音播报与口型联动验证。',
    'settings.companion.enable.title': '开启桌面伴侣',
    'settings.companion.enable.description': '开启后，可将聊天内容通过伴侣语音播报。',
    'settings.companion.provider.label': 'TTS 提供商',
    'settings.companion.provider.option.volcano': '火山引擎',
    'settings.companion.provider.option.qwen': 'Qwen-TTS',
    'settings.companion.model.label': '模型',
    'settings.companion.voice.label': '音色',
    'settings.companion.voice.volcano.cardTitle': '火山音色列表',
    'settings.companion.voice.volcano.cardHint': '支持按名称或 voice_type 搜索',
    'settings.companion.voice.volcano.searchPlaceholder': '搜索音色名称 / voice_type',
    'settings.companion.voice.volcano.noResult': '没有匹配项，可继续手动输入。',
    'settings.companion.namespace.label': '命名空间',
    'settings.companion.endpoint.label': '接口地址',
    'settings.companion.apiKey.label': 'Access Token（访问令牌）',
    'settings.companion.appKey.label': 'AppID（应用 ID）',
    'settings.companion.clearSavedApiKey': '清除已保存的 Access Token',
    'settings.companion.clearSavedAppKey': '清除已保存的 App Key',
    'settings.companion.test.title': '伴侣语音测试',
    'settings.companion.test.description': '播放样例语句，验证接口与口型联动链路。',
    'settings.companion.test.sample': '你好，欢迎体验桌面伴侣语音功能。',
    'settings.companion.test.label': '测试语句',
    'settings.companion.test.play': '播放测试',
    'settings.companion.test.stop': '停止',
    'settings.companion.test.speaking': '正在播放…',
    'settings.companion.test.testError': '测试失败',
    'settings.companion.test.error.kind.service': '服务不可用',
    'settings.companion.test.error.kind.config': '参数配置问题',
    'settings.companion.test.error.kind.playback': '播放问题',
    'settings.companion.test.error.kind.unknown': '未知问题',
    'companion.live2d.title': 'Live2D 模型',
    'companion.live2d.description': '上传、启用和管理桌面伴侣的本地 Live2D 模型。',
    'companion.live2d.upload.label': 'Live2D 模型文件',
    'companion.live2d.uploading': '上传中…',
    'companion.live2d.upload.button': '上传模型',
    'companion.live2d.upload.helper': '支持 zip 或模型文件，上传后可直接设为当前模型。',
    'companion.live2d.models.title': '模型库',
    'companion.live2d.models.loading': '模型库加载中…',
    'companion.live2d.models.empty': '尚未上传模型。',
    'companion.live2d.models.uploaded': '已上传',
    'companion.live2d.models.current': '当前模型',
    'companion.live2d.item.setActive': '设为当前',
    'companion.live2d.item.active': '已启用',
    'companion.live2d.item.remove': '删除',
    'companion.live2d.item.removing': '删除中…',
    'companion.live2d.item.size': '大小',
    'companion.live2d.item.updated': '更新时间',
    'companion.live2d.preview.loading': '正在加载模型…',
    'companion.live2d.preview.noModel': '未选择当前模型。',
    'companion.live2d.preview.preview': 'Live2D 预览',
    'companion.live2d.preview.failed': 'Live2D 预览失败',
    'companion.live2d.preview.failedToOpenFloatingWindow': '打开独立弹窗失败',
    'companion.page.toLabs': '返回实验区',
    'companion.live2d.error.empty': '请先选择一个模型文件。',
    'companion.live2d.error.uploadFailed': '上传失败',
    'companion.live2d.error.removeFailed': '删除失败',
    'companion.live2d.error.setActiveFailed': '切换失败',
    'companion.live2d.error.unsupportedType': '不支持的模型文件类型。',
    'companion.live2d.error.tooLarge': '文件过大',
    'companion.state.title': '伴侣动作状态',
    'companion.state.mode.idle': '空闲',
    'companion.state.mode.thinking': '思考中',
    'companion.state.mode.speaking': '发声中',
    'companion.state.source': '来源',
    'companion.state.sourceUnknown': '未知',
    'companion.state.updated': '更新时间',
    'companion.state.updatedUnknown': '未开始',
    'settings.keys.title': 'Keys',
    'settings.keys.description': '管理 Provider 的 API Key 与预设。Setup Wizard 会使用这里保存的 Key。',
    'settings.keys.open': '打开 Keys',
    'settings.keys.openWizard': '打开 Setup Wizard',
    'settings.memory.title': '记忆同步',
    'settings.memory.description': '备份并恢复本地记忆，用于多设备同步。口令不会被保存。',
    'settings.memory.backupNow': '立即备份',
    'settings.memory.restoreLatest': '恢复最新备份',
    'settings.memory.refresh': '刷新',
    'settings.memory.refreshing': '刷新中…',
    'settings.memory.lastBackup': '上次备份',
    'settings.memory.lastRestore': '上次恢复',
    'settings.memory.lastError': '上次错误',
    'settings.memory.statusLoading': '正在加载状态…',
    'settings.memory.statusUnavailable': '状态不可用。',
    'settings.memory.dialog.backupTitle': '立即备份记忆',
    'settings.memory.dialog.restoreTitle': '恢复最新记忆',
    'settings.memory.dialog.description': '请输入口令用于加密/解密记忆快照。口令不会被保存。',
    'settings.memory.dialog.cancel': '取消',
    'settings.memory.dialog.continue': '继续',
    'settings.memory.dialog.working': '处理中…',
    'settings.memory.passphrase.label': '口令',
    'settings.memory.passphrase.placeholder': '输入口令',
    'settings.memory.passphrase.show': '显示',
    'settings.memory.passphrase.hide': '隐藏',
    'discover.page.title': 'Discover',
    'discover.page.subtitle': '浏览 OpenClaw 社区资源、模板和实战技能包。',
    'discover.tab.home': '首页',
    'discover.tab.community': '社区',
    'discover.hero.badge': '第 1 步',
    'discover.hero.title': '先设置 OpenClaw',
    'discover.hero.description': '先完成 OpenClaw 安装，再继续配置 Provider 和渠道连接。',
    'discover.hero.step1': '1. 安装 OpenClaw',
    'discover.hero.step2': '2. 配置 Provider',
    'discover.hero.step3': '3. 连接渠道',
    'discover.status.openclaw.ready': 'OpenClaw 已就绪',
    'discover.status.openclaw.missing': 'OpenClaw 缺失',
    'discover.status.provider.ready': 'Provider 已就绪',
    'discover.status.provider.pending': 'Provider 待配置',
    'discover.button.installOpenclaw': '安装 OpenClaw',
    'discover.button.continueWizard': '继续引导向导',
    'discover.button.openingWizard': '正在打开向导…',
    'discover.button.startChat': '开始聊天',
    'discover.button.openingChat': '正在打开聊天…',
    'discover.button.recheck': '重新检测',
    'discover.button.settings': '设置',
    'discover.recommended.title': '推荐',
    'discover.recommended.cloud.title': '云端 OpenClaw',
    'discover.recommended.cloud.description': '一键开通云端托管 OpenClaw，并提供引导式配置。',
    'discover.recommended.cloud.cta': '查看云端方案',
    'discover.recommended.api.title': 'API 优惠',
    'discover.recommended.api.description': '查看可用的模型优惠渠道与预设 BYOK 配置。',
    'discover.recommended.api.cta': '查看优惠',
    'discover.recommended.guide.title': '新手指南',
    'discover.recommended.guide.description': '面向非开发者的步骤化使用教程。',
    'discover.recommended.guide.cta': '打开指南',
    'discover.recommended.redeem.title': '兑换红包',
    'discover.recommended.redeem.description': '输入兑换码领取活动 Key，并直接保存到本地配置。',
    'discover.recommended.redeem.cta': '打开兑换红包',
    'discover.recommended.telegram.title': '连接 OpenClaw 到 Telegram',
    'discover.recommended.telegram.description': '一分钟内连接你的 Telegram 机器人。OpenClaw 会智能引导你完成配置。',
    'discover.recommended.telegram.cta': '连接 Telegram',
    'discover.community.title': '社区',
    'discover.community.description': '敬请期待。这里会发布面向新手的教程与实战攻略。',
    'discover.errors.gatewayNotReady': 'OpenClaw 网关尚未就绪。',
    'setupWizard.page.title': '设置向导',
    'setupWizard.page.subtitle': '先准备 Key，再安装 OpenClaw。',
    'setupWizard.keys.cardTitle': '第一步 · 准备 Key',
    'setupWizard.keys.blurb': 'OpenClaw/Codex/Claude Code 都需要 Key 才能跑。先保存一个 Key 预设并设为 Active。',
    'setupWizard.keys.status.ready': 'Key 已准备好。',
    'setupWizard.keys.status.missing': '还没有可用的 Key。请先添加一个 Key 预设。',
    'setupWizard.keys.button.openKeys': '去 Keys 管理',
    'setupWizard.field.provider': '提供商',
    'setupWizard.field.model': '模型',
    'setupWizard.field.searchModels': '搜索模型…',
    'setupWizard.field.baseUrl': 'Base URL',
    'setupWizard.field.apiKey': 'API Key',
    'setupWizard.field.show': '显示',
    'setupWizard.field.hide': '隐藏',
    'setupWizard.hint.pickModel': '从列表选择，或输入任意模型。',
    'setupWizard.hint.baseUrlDefault': '大多数提供商不需要更改 Base URL。',
    'setupWizard.placeholder.baseUrl': 'https://api.openai.com/v1',
    'setupWizard.placeholder.apiKey': '粘贴 API Key',
    'setupWizard.button.saving': '保存中…',
    'setupWizard.button.save': '保存',
    'setupWizard.install.cardTitle': '第二步 · 安装 OpenClaw',
    'setupWizard.channel.cardTitle': '第三步 · 连接渠道',
    'setupWizard.step1.cardTitle': '第 1 步 · 安装 OpenClaw',
    'setupWizard.step2.cardTitle': '第 2 步 · 配置 Provider',
    'setupWizard.step3.cardTitle': '第 3 步 · 连接渠道',
    'setupWizard.step1.blurb': 'OpenClaw 提供本地网关与聊天 UI。先安装它才能继续。',
    'setupWizard.step1.button.install': '安装 OpenClaw',
    'setupWizard.step1.button.installing': '安装中…',
    'setupWizard.step1.button.retryInstall': '重试安装 OpenClaw',
    'setupWizard.step1.hint.liveOutput': '实时输出会显示在「运行会话」面板中。',
    'setupWizard.step1.troubleshooting': '排查问题',
    'setupWizard.step1.button.refreshDetection': '刷新检测',
    'setupWizard.step1.button.viewRuntimeSession': '查看运行会话',
    'setupWizard.step1.hint.sessionPanel': '如果安装看起来卡住了，打开会话面板查看输出。',
    'setupWizard.step2.blurb': '设置 OpenClaw 要使用的 Provider。我们只强调下一步。',
    'setupWizard.step2.mode.existing': '使用已有配置',
    'setupWizard.step2.mode.new': '新增配置',
    'setupWizard.step2.button.switchMode': '切换',
    'setupWizard.step2.selectedProfile.title': '已选配置',
    'setupWizard.step2.selectedProfile.active': '已启用',
    'setupWizard.step2.selectedProfile.none': '请选择一个配置以继续。',
    'setupWizard.step2.button.useProfile': '使用该配置',
    'setupWizard.step2.button.applying': '应用中…',
    'setupWizard.step2.noProfileFound': '还没有任何配置。请点击「切换」来新增。',
    'setupWizard.step2.changeProfile': '切换配置',
    'setupWizard.step2.profileSelect.label': 'Provider 配置',
    'setupWizard.step2.profileSelect.activeSuffix': '（已启用）',
    'setupWizard.step2.profileSelect.hint': '在点击「使用该配置」之前，这里不会生效。',
    'setupWizard.step2.addNewInstead': '改为新增 Provider',
    'setupWizard.step2.button.switchToAddNew': '切换到新增',
    'setupWizard.step2.provider.title': 'Provider',
    'setupWizard.step2.providerType.label': 'Provider 类型',
    'setupWizard.step2.changeProvider': '切换 Provider',
    'setupWizard.step2.optionalProfileName': '可选：配置名称',
    'setupWizard.step2.profileName.placeholder': '配置名称（可选）',
    'setupWizard.step2.baseUrl.placeholder': 'https://api.openai.com/v1',
    'setupWizard.step2.apiKey.placeholder': '粘贴 API Key',
    'setupWizard.step2.model.placeholder': 'provider/model',
    'setupWizard.step2.button.saveProfile': '保存配置',
    'setupWizard.step2.button.saving': '保存中…',
    'setupWizard.step2.useExistingInstead': '改用已有配置',
    'setupWizard.step2.button.switchToExisting': '切换到已有',
    'setupWizard.step3.blurb': '你可以直接启动本地聊天，或连接渠道从你的应用中与 OpenClaw 对话。',
    'setupWizard.step3.channel.title': '渠道',
    'setupWizard.step3.channel.label': '渠道',
    'setupWizard.step3.changeChannel': '切换渠道',
    'setupWizard.step3.status.telegram.checking': '正在检查 OpenClaw JSON 中的 Telegram 配置…',
    'setupWizard.step3.status.telegram.configured': 'Telegram 已在 OpenClaw JSON 中配置完成。',
    'setupWizard.step3.status.telegram.exists': 'Telegram 段落已存在，但 OpenClaw JSON 中仍缺少 key/secret。',
    'setupWizard.step3.status.telegram.missing': 'OpenClaw JSON 里还没有配置 Telegram。',
    'setupWizard.step3.status.feishu.checking': '正在检查 OpenClaw JSON 中的 Feishu 配置…',
    'setupWizard.step3.status.feishu.configured': 'Feishu 已在 OpenClaw JSON 中配置完成。',
    'setupWizard.step3.status.feishu.exists': 'Feishu 段落已存在，但 OpenClaw JSON 中仍缺少 key/secret。',
    'setupWizard.step3.status.feishu.missing': 'OpenClaw JSON 里还没有配置 Feishu。',
    'setupWizard.step3.status.discord.checking': '正在检查 OpenClaw JSON 中的 Discord 配置…',
    'setupWizard.step3.status.discord.configured': 'Discord 已在 OpenClaw JSON 中配置完成。',
    'setupWizard.step3.status.discord.exists': 'Discord 段落已存在，但 OpenClaw JSON 中仍缺少 key/secret。',
    'setupWizard.step3.status.discord.missing': 'OpenClaw JSON 里还没有配置 Discord。',
    'setupWizard.step3.button.settingUp': '配置中…',
    'setupWizard.step3.button.setup.telegram': '配置 Telegram',
    'setupWizard.step3.button.setup.feishu': '配置 Feishu',
    'setupWizard.step3.button.setup.discord': '配置 Discord',
    'setupWizard.step3.button.opening': '正在打开…',
    'setupWizard.step3.button.startChat': '开始聊天',
    'setupWizard.step3.otherActions': '其他操作',
    'setupWizard.errors.baseUrlRequired': 'Base URL 不能为空。',
    'setupWizard.errors.modelRequired': 'Model 不能为空。',
    'setupWizard.errors.apiKeyRequired': 'API key 不能为空。',
    'setupWizard.errors.completeStepsBeforeChannel': '请先准备 Key 并安装 OpenClaw，再进行渠道配置。',
    'setupWizard.errors.gatewayNotReadyAfterInstall': 'OpenClaw 已安装，但网关尚未就绪。',
    'setupWizard.errors.gatewayNotReady': 'OpenClaw 网关尚未就绪。',
    'setupWizard.errors.openclawInstalledButNotOnPath': 'OpenClaw 已安装，但当前 shell 的 PATH 还找不到 openclaw。',
    'setupWizard.errors.tipOpenTerminalRun': '提示：打开终端并运行：openclaw gateway install',
    'setupWizard.advice.installGatewayRestart': '- 可尝试运行：openclaw gateway install && openclaw gateway restart',
    'setupWizard.advice.gatewayRestart': '- 可尝试运行：openclaw gateway restart',
    'setupWizard.advice.logsPrefix': '- 日志：',
    'setupWizard.messages.providerProfileSelectedActive': '已选择并启用 Provider 配置。',
    'setupWizard.messages.providerProfileAlreadyActive': '该 Provider 配置已启用。',
    'setupWizard.messages.newProviderProfileSavedActive': '已保存新配置并设为启用。',
    'setupWizard.messages.openclawInstalled': 'OpenClaw 已安装。',
    'setupWizard.messages.openclawInstalledGatewaySecured': 'OpenClaw 已安装。网关已加固为仅 loopback。',
    'setupWizard.messages.openclawInstalledGatewaySecuredReady': 'OpenClaw 已安装。网关已加固为仅 loopback 且已就绪。',
    'setupWizard.messages.openclawInstalledGatewayReady': 'OpenClaw 已安装。网关已就绪。',
    'setupWizard.messages.openclawChatOpened': '已打开 OpenClaw 聊天。',
    'setupWizard.session.actionLabel.installUpgrade': '安装/升级',

    'keys.page.title': 'Key Hub',
    'keys.page.subtitle': '模型要跑起来，得先有 Key。保存、验证、复用。',
    'keys.page.openMarketplace': '打开 Key 商城',
    'keys.page.backToWizard': '返回 Setup Wizard',
    'keys.page.whatIsThis.title': '这是做什么的？',
    'keys.page.whatIsThis.p1': 'OpenClaw、Codex、Claude Code 这些 bot 都需要 Provider Key 才能跑。',
    'keys.page.whatIsThis.p2': '你可以保存多个预设，随时切换 Active，而不用重复输入。',

    'keys.manager.title': 'Key 管理',
    'keys.manager.description': '创建 Provider 预设，验证可用，然后设为 Active。',
    'keys.manager.newProfile': '新建预设',
    'keys.manager.active': 'Active',
    'keys.fields.profileName': '预设名称',
    'keys.fields.profileNamePlaceholder': '我的 OpenAI',
    'keys.fields.provider': 'Provider',
    'keys.fields.baseUrl': 'Base URL',
    'keys.fields.headers': 'Headers (JSON)',
    'keys.fields.authHeader': '使用 Auth Header',
    'keys.fields.inputCapabilities': '输入能力',
    'keys.fields.inputText': '文本',
    'keys.fields.inputImage': '图片',
    'keys.fields.apiKey': 'API Key',
    'keys.fields.apiKeyPlaceholder': '粘贴 API Key',
    'keys.fields.model': '模型',
    'keys.fields.searchPlaceholder': '搜索预设…',
    'keys.fields.setActiveOnSave': '保存时设为 Active',
    'keys.sections.profiles': '预设',
    'keys.sections.details': '详情',
    'keys.actions.show': '显示',
    'keys.actions.hide': '隐藏',
    'keys.actions.copy': '复制',
    'keys.actions.copied': '已复制',
    'keys.actions.verify': '验证',
    'keys.actions.verifying': '验证中…',
    'keys.actions.save': '保存',
    'keys.actions.saving': '保存中…',
    'keys.actions.saveSetActive': '保存并设为 Active',
    'keys.actions.setActive': '设为 Active',
    'keys.actions.edit': '编辑',
    'keys.actions.delete': '删除',
    'keys.actions.deleting': '删除中…',
    'keys.actions.more': '更多',
    'keys.actions.pick': '选择',
    'keys.actions.showAdvanced': '高级',
    'keys.actions.hideAdvanced': '高级',
    'keys.delete.title': '删除这个 Key 预设？',
    'keys.delete.description': '会从当前设备移除该预设。',
    'keys.delete.cancel': '取消',
    'keys.delete.confirm': '删除',
    'keys.errors.baseUrlRequired': 'Base URL 不能为空。',
    'keys.errors.headersJsonInvalid': 'Headers 必须是合法的 JSON 对象。',
    'keys.errors.modelRequired': '模型不能为空。',
    'keys.errors.apiKeyRequired': 'API Key 不能为空。',
    'keys.messages.verifyOk': '验证成功。',
    'keys.messages.verifyFailed': '验证失败',
    'keys.messages.saved': '已保存。',
    'keys.messages.savedSetActive': '已保存并设为 Active。',
    'keys.messages.saveFailed': '保存失败',
    'keys.messages.setActiveOk': '已更新 Active Key。',
    'keys.messages.setActiveFailed': '设为 Active 失败',
    'keys.messages.deleted': '已删除。',
    'keys.messages.deleteFailed': '删除失败',
    'keys.hint.authHeader': '当提供商要求通过 Authorization Header 传递 API Key 时开启。',

    'link.page.title': 'Link',
    'link.page.subtitle': '正在处理 deep link 并跳转…',

    'logs.page.title': '守护进程日志',
    'logs.page.clear': '清空',
    'logs.page.noLogs': '暂无日志。',
    'logs.page.refreshAriaLabel': '刷新',

    'softwareCenter.page.title': 'Dashboard',
    'softwareCenter.page.subtitle': '聚焦管理 OpenClaw 的安装、升级、卸载与打开。',
    'softwareCenter.refresh': '刷新',
    'softwareCenter.checkingUpdates': '检查更新中…',
    'softwareCenter.checkUpdates': '检查更新',
    'softwareCenter.runtimeSession': '运行会话',
    'softwareCenter.hideSession': '隐藏会话',
    'softwareCenter.showSession': '显示会话',
    'softwareCenter.error.runtimeDetectionFailed': '运行时检测失败：',
    'softwareCenter.error.openRuntimeFailed': '打开运行时失败：',
    'softwareCenter.status.checking': '检测中…',
    'softwareCenter.status.installed': '已安装',
    'softwareCenter.status.missing': '未安装',
    'softwareCenter.field.command': '命令：',
    'softwareCenter.field.version': '版本：',
    'softwareCenter.field.version.detecting': '检测中…',
    'softwareCenter.field.version.unavailable': '不可用',
    'softwareCenter.field.entry': '入口：',
    'softwareCenter.button.installing': '安装中…',
    'softwareCenter.button.opening': '打开中…',
    'softwareCenter.button.installCli': '安装 CLI',
    'softwareCenter.button.openApp': '打开应用',
    'softwareCenter.button.upgrade': '升级',
    'softwareCenter.button.upgradeTo': '升级到',
    'softwareCenter.button.uninstall': '卸载',
    'softwareCenter.button.preparing': '准备中…',
    'softwareCenter.button.openClawOnly': '仅限 OpenClaw',
    'softwareCenter.message.noUpdates': '未发现可用运行时更新。',
    'softwareCenter.message.workanyDownloadOpened': '已打开 WorkAny 下载：',
    'softwareCenter.message.updateCheckFailed': '检查更新失败：',
    'softwareCenter.message.installFailed': '安装失败：',
    'softwareCenter.message.upgradeFailed': '升级失败：',
    'softwareCenter.message.uninstallFailed': '卸载失败：',
    'softwareCenter.message.commandFailedTip': '提示：使用「打开终端」手动运行命令。',
    'softwareCenter.message.onlyOpenClawUninstall': '仅支持卸载 OpenClaw。',
    'softwareCenter.message.gatewayNotReady': 'OpenClaw 已安装/更新，但网关尚未就绪。',
    'softwareCenter.message.gatewayStartingFallback': '未检测到网关。正在启动备用网关（后台）…',
    'softwareCenter.message.gatewayRunning': '网关运行中。',
    'softwareCenter.message.openclawInstalledStillFound': '卸载完成，但 openclaw 仍然存在。可能存在其他安装。',
    'softwareCenter.message.updateAvailable': 'OpenClaw 已安装，但当前 shell PATH 中找不到 openclaw。',
    'softwareCenter.message.remoteActionInvalid': '远程动作无效：',
    'softwareCenter.message.remoteActionOpened': '已打开远程动作',
    'softwareCenter.message.commandFailed': '命令执行失败',
    'softwareCenter.message.onlyOpenClawSupported': '仅支持 OpenClaw。',
    'softwareCenter.message.restartGatewayFailed': '重启 Gateway 失败：',
    'softwareCenter.prefetch.background': '（后台）',
    'softwareCenter.badge.new': '新',
    'softwareCenter.button.restartGateway': '重启网关',
    'softwareCenter.button.restartingGateway': '重启中…',
    'softwareCenter.button.webDashboard': '网页控制台',
    'softwareCenter.button.openChat': '打开会话',
    'softwareCenter.button.reloadConfig': '重新加载配置',
    'softwareCenter.button.saveChanges': '保存修改',
    'softwareCenter.button.savingChanges': '保存中…',
    'softwareCenter.error.overviewLoadFailed': '加载概览快照失败：',
    'softwareCenter.overview.loading': '加载中...',
    'softwareCenter.overview.auto': '自动',
    'softwareCenter.overview.notDetected': '未检测到',
    'softwareCenter.overview.gatewayAccess.title': '网关访问',
    'softwareCenter.overview.gatewayAccess.subtitle': '仪表板连接的位置及其身份验证方式。',
    'softwareCenter.overview.checks.title': 'Checks',
    'softwareCenter.overview.checks.subtitle': '把 Agent 设定与渠道、认证、运行时检查放在同一行集中查看。',
    'softwareCenter.overview.snapshot.title': '快照',
    'softwareCenter.overview.snapshot.subtitle': '最新的网关握手信息。',
    'softwareCenter.overview.field.websocketUrl': 'WebSocket 地址',
    'softwareCenter.overview.field.gatewayToken': '网关令牌',
    'softwareCenter.overview.field.sessionKey': '默认会话密钥',
    'softwareCenter.overview.field.language': '语言',
    'softwareCenter.overview.field.status': '状态',
    'softwareCenter.overview.field.gatewayProcess': '网关进程',
    'softwareCenter.overview.field.port': '端口',
    'softwareCenter.overview.field.chatReachability': '聊天可达性',
    'softwareCenter.overview.field.channelsReady': '渠道就绪',
    'softwareCenter.overview.field.providerAuth': '认证状态',
    'softwareCenter.overview.field.runtimeChecks': '运行时检查',
    'softwareCenter.overview.field.agent': '代理',
    'softwareCenter.overview.field.workspace': '工作空间',
    'softwareCenter.overview.field.skills': '技能',
    'softwareCenter.overview.field.primaryModel': '主模型',
    'softwareCenter.overview.status.online': '在线',
    'softwareCenter.overview.status.offline': '离线',
    'softwareCenter.overview.status.running': '运行中',
    'softwareCenter.overview.status.stopped': '已停止',
    'softwareCenter.overview.status.listening': '监听中',
    'softwareCenter.overview.status.notListening': '未监听',
    'softwareCenter.overview.status.reachable': '可达',
    'softwareCenter.overview.status.unreachable': '不可达',
    'softwareCenter.overview.status.ready': '就绪',
    'softwareCenter.overview.status.missing': '缺失',
    'softwareCenter.overview.providerAuthHint': 'auth-profiles 配置状态',
    'softwareCenter.overview.runtimeChecksHint': '健康检查通过',
    'softwareCenter.overview.token.hide': '隐藏令牌',
    'softwareCenter.overview.token.show': '显示令牌',
    'softwareCenter.overview.agent.title': 'Agent Review',
    'softwareCenter.overview.agent.subtitle': '选择代理后查看模型配置摘要。',
    'softwareCenter.overview.agent.defaultSuffix': '(默认)',
    'softwareCenter.overview.agent.currentPrefix': '当前',
    'softwareCenter.overview.agent.noConfiguredModels': '没有可用模型',
    'softwareCenter.overview.agent.group.keyHub': 'Key Hub',
    'softwareCenter.overview.agent.group.openclawSettings': 'OpenClaw 配置',
    'softwareCenter.overview.value.defaultWorkspace': '默认',
    'softwareCenter.overview.value.allSkills': '全部技能',
    'softwareCenter.overview.installOverlay.title': '未检测到 OpenClaw 运行时',
    'softwareCenter.overview.installOverlay.description': '请先安装 OpenClaw。安装完成后，这里的 Overview 卡片会自动显示实时状态。',
    'softwareCenter.overview.installOverlay.installing': '安装 OpenClaw…',
    'softwareCenter.overview.installOverlay.install': '安装 OpenClaw',
    'softwareCenter.section.checks.title': 'Checks',
    'softwareCenter.section.checks.subtitle': '安全检查、渠道就绪度和 Provider 认证状态。',
    'softwareCenter.section.agent.title': 'Agent 设定',
    'softwareCenter.section.agent.subtitle': '选择 Agent 并切换主模型。',
    'softwareCenter.section.gateway.title': 'Gateway 健康与设定',
    'softwareCenter.section.gateway.subtitle': 'Gateway 连接、Token、入口与运行健康状态。',
    'softwareCenter.section.layout.display': '显示区',
    'softwareCenter.section.layout.actions': '操作区',
    'softwareCenter.section.actions.recheck': '重新检查',

    'chat.page.title': '聊天',
    'chat.page.subtitle': '在 HolyCrab 内直接与 OpenClaw 主代理对话。',
    'chat.status.checking': '正在检查 OpenClaw 状态…',
    'chat.status.connected': '网关已连接',
    'chat.status.disconnected': '网关未连接',
    'chat.mask.title': 'OpenClaw 尚未就绪',
    'chat.mask.description': '请先完成Setup Wizard，OpenClaw Agent就可以和你对话了',
    'chat.mask.openWizard': '打开 Setup Wizard',
    'chat.mask.retryGateway': '重试连接网关',
    'chat.history.loading': '正在加载会话…',
    'chat.history.empty': '还没有消息，开始一段新会话吧。',
    'chat.tips.button': '提示',
    'chat.tips.title': '提示',
    'chat.scrollToBottom': '滚动到底部',
    'chat.input.placeholder.ready': '给 OpenClaw 发送消息（Shift+Enter 换行，支持粘贴图片）…',
    'chat.input.placeholder.disabled': '请先完成 Setup Wizard，再回来聊天。',
    'chat.input.send': '发送',
    'chat.input.queue': '排队发送',
    'chat.input.sending': '发送中…',
    'chat.input.busyRunning': 'AI 正在回复，你可以继续输入并点击“排队发送”。',
    'chat.input.busyQueuePrefix': '排队消息数：',
    'chat.input.markdownHint': '支持 Markdown 输入',
    'chat.input.expand': '加高',
    'chat.input.collapse': '恢复',
    'chat.input.dictationProcessing': '听写处理中…',
    'chat.suggestion.note.title': '任务清单',
    'chat.suggestion.note.prompt': '创建一个标题为“今日任务”的笔记，列出最重要的三件事，并给出明确下一步。',
    'chat.suggestion.note.body': '生成精简的每日任务笔记与行动清单。',
    'chat.suggestion.workflow.title': '流程风险检查',
    'chat.suggestion.workflow.prompt': '审查我当前工作流，列出前五个操作风险并给出缓解步骤。',
    'chat.suggestion.workflow.body': '分析工作流风险并给出可执行的缓解建议。',
    'chat.suggestion.key.badge': '升级建议',
    'chat.suggestion.key.title': '觉得 OpenClaw 不够聪明？试试换一个更聪明更全面的模型',
    'chat.suggestion.key.body': '更高质量模型能显著提升任务理解、工具调用和复杂推理效果。',
    'chat.suggestion.key.highlight1': '更聪明模型',
    'chat.suggestion.key.highlight2': '特别回馈入口',
    'chat.suggestion.key.cta': '查看特别回馈',
    'chat.suggestion.dashboard.badge': '控制中心',
    'chat.suggestion.dashboard.title': 'OpenClaw 运行状态在哪里？网关、Agent、安全都在控制面板',
    'chat.suggestion.dashboard.body': '统一查看 Gateway、Agent、认证与健康检查，定位问题更快。',
    'chat.suggestion.dashboard.highlight1': '网关 + Agent',
    'chat.suggestion.dashboard.highlight2': '安全与健康检查',
    'chat.suggestion.dashboard.cta': '前往控制面板',
    'chat.suggestion.insight.badge': '实战案例',
    'chat.suggestion.insight.title': '市场速览',
    'chat.suggestion.insight.prompt': '给我一份 BTC 和 ETH 的简短市场快照，并附上未来 24 小时风险提示。',
    'chat.suggestion.insight.body': '让 OpenClaw 成为智能分析师？简单案例调教 OpenClaw，一学就会。',
    'chat.suggestion.insight.highlight1': '可视化输出模板',
    'chat.suggestion.insight.highlight2': '24h 风险提示',
    'chat.suggestion.insight.ctaTry': '马上试试',
    'chat.suggestion.insight.ctaMore': '更多案例',

    'nav.chat': '聊天',
    'nav.community': '社区',
    'nav.discover': '发现',
    'nav.softwareCenter': '控制台',
    'nav.keys': '密钥中心',
    'nav.tts': '语音模型',
    'nav.channels': '渠道',
    'nav.settings': '设置',
    'nav.logs': '日志',

    'tts.page.title': '语音模型',
    'tts.page.subtitle': '配置并测试语音模型。',

    'channels.page.title': '渠道配置',
    'channels.page.subtitle': '管理 OpenClaw 渠道配置，执行测试，并触发 WhatsApp 登录。',
    'channels.list.title': '渠道列表',
    'channels.list.subtitle': '选择一个渠道进行编辑或测试。',
    'channels.list.empty': 'daemon 暂未返回任何渠道。',
    'channels.form.title': '渠道配置',
    'channels.form.subtitle': '编辑 JSON 配置并对当前渠道执行操作。',
    'channels.form.channelId': '渠道 ID',
    'channels.form.status': '状态',
    'channels.form.configJson': '配置 JSON',
    'channels.form.commonFields.title': '常用字段',
    'channels.form.commonFields.subtitle': '优先填写常用字段；自定义或未知字段可在高级 JSON 中维护。',
    'channels.form.commonFields.empty': '该渠道暂无预置字段，请在下方高级 JSON 中编辑。',
    'channels.form.advanced.title': '高级 JSON',
    'channels.form.advanced.subtitle': '用于保留未知字段和自定义字段，避免配置丢失。',
    'channels.form.advanced.invalidJson': '高级 JSON 解析失败，请检查格式。',
    'channels.form.advanced.requireObject': '高级 JSON 必须是对象。',
    'channels.form.whatsappHint': 'WhatsApp 登录会在 daemon 中启动本地设备绑定流程。',
    'channels.status.configured': '已配置',
    'channels.status.notConfigured': '未配置',
    'channels.actions.save': '保存',
    'channels.actions.saving': '保存中…',
    'channels.actions.test': '测试',
    'channels.actions.testing': '测试中…',
    'channels.actions.clear': '清空',
    'channels.actions.clearing': '清空中…',
    'channels.actions.whatsappLogin': 'WhatsApp 登录',
    'channels.actions.whatsappLoggingIn': '正在启动 WhatsApp 登录…',
    'channels.actions.askAi': 'Ask AI',
    'channels.actions.clearConfirm': '确认清空当前渠道配置？',
    'channels.feedback.loadFailed': '加载渠道失败',
    'channels.feedback.saveSuccess': '渠道配置已保存。',
    'channels.feedback.testSuccess': '渠道测试已触发。',
    'channels.feedback.clearSuccess': '渠道配置已清空。',
    'channels.feedback.loginStarted': 'WhatsApp 登录已启动。',
    'channels.feedback.loginInstructions': '请在弹出的终端窗口中扫描二维码完成登录。',
    'channels.feedback.loginSuccess': 'WhatsApp 登录成功。',
    'channels.feedback.loginTimeout': 'WhatsApp 登录状态检查超时，请扫码后重试。',

    'theme.lightMode': '浅色模式',
    'theme.darkMode': '深色模式',

    'keys.hint.searchModels': '搜索模型…',
    'keys.hint.pickOrTypeModel': '选择建议或输入自己的模型。',
    'keys.hint.baseUrlDefault': '大多数提供商不需要更改 Base URL。',
    'keys.error.providerLoadFailed': '提供商加载失败：',
    'keys.placeholder.model': '模型',
    'keys.placeholder.baseUrl': 'https://api.openai.com/v1',

    'runtime.defaultLabel': 'OpenClaw',

    'settings.security.title': '安全检查',
    'settings.security.description': '检查 OpenClaw 的入站端口是否正在监听，以及它是绑定到 loopback 还是网络接口。如果 socket 检查失败，绑定状态将显示为未知。',
    'settings.security.button.run': '运行检查',
    'settings.security.button.running': '运行中…',
    'settings.security.label.port': '端口',
    'settings.security.label.listener': '监听器',
    'settings.security.label.listening': '正在监听',
    'settings.security.label.notListening': '未监听',
    'settings.security.label.binding': '绑定',
    'settings.security.status.loopbackOnly': '仅 loopback (127.0.0.1 / ::1)',
    'settings.security.status.allInterfaces': '暴露给所有接口 (0.0.0.0 / ::)',
    'settings.security.status.nonLoopback': '暴露给网络接口',
    'settings.security.status.notListening': '未监听',
    'settings.security.status.unknown': '未知（无法检查 sockets）',
    'settings.security.button.fix': '修复并重启 OpenClaw',
    'settings.security.button.fixing': '修复中…',
    'settings.security.fix.setDescription': '设置 gateway.bind=loopback 并重启网关（仅本地）。',
    'settings.security.label.openclawHooksUrl': 'OpenClaw Hooks URL',
    'settings.security.label.listeningAddresses': '监听地址',
    'settings.security.label.fix': '修复',
    'settings.security.status.succeeded': '成功',
    'settings.security.status.failed': '失败',
    'settings.security.fixResult.configUpdated': '（配置已更新）',
    'settings.security.fixResult.noConfigChange': '（配置未更改）',
    'settings.security.fixResult.restarted': '，已重启',
    'settings.security.fixResult.notRestarted': '，未重启',
    'settings.security.label.config': '配置',

    'discover.errors.logsPrefix': '- 日志：',
    'discover.hero.nextSlide': '下一张',
    'discover.hero.prevSlide': '上一张',
    'locale.switch.chinese': '中文',
    'locale.switch.chineseShort': '中',
    'locale.switch.english': '英文',
    'locale.switch.englishShort': 'EN',
    'redeem.page.title': '兑换红包 Key',
    'redeem.input.placeholder': '输入 redeem code',
    'redeem.button.claim': '领取',
    'redeem.button.claiming': '领取中…',
    'redeem.button.saveClose': '保存并关闭',
    'redeem.button.saving': '保存中…',
    'redeem.labels.provider': 'Provider',
    'redeem.labels.model': 'Model',
    'redeem.labels.baseUrl': 'Base URL',
    'redeem.labels.apiKey': 'API key',
    'redeem.messages.saved': '已保存：',
    'redeem.errors.generic': '兑换失败',
    'redeem.errors.emptyModel': '兑换失败：返回的 model 为空',
    'redeem.errors.emptyApiKey': '兑换失败：返回的 key 为空',
    'redeem.errors.resourceMissing': '兑换失败：data[0].resource 缺失',
    'redeem.errors.resourceInvalidJson': '兑换失败：resource 不是合法 JSON',
    'redeem.errors.resourceInvalidFormat': '兑换失败：resource 格式错误',
    'redeem.errors.noData': '兑换失败：无可用 data[0]',
    'redeem.errors.codeRequired': '请输入兑换码',
    'redeem.errors.serviceUnavailable': '兑换失败：无法连接领取服务',
    'redeem.errors.httpPrefix': '兑换失败：HTTP',
    'redeem.errors.responseInvalidPrefix': '兑换失败：响应格式错误（',
    'redeem.errors.responseInvalidSuffix': '）',
    'redeem.errors.responseEmpty': '兑换失败：响应为空',
    'settings.comingSoon': '敬请期待。',
    'settings.memory.comingSoonSuffix': '（敬请期待）',
    'settings.memory.error.passphraseRequired': '口令不能为空。',
    'settings.memory.error.statusFailedPrefix': '记忆同步状态获取失败：',
    'settings.memory.message.backupCompleted': '备份完成。',
    'settings.memory.message.restoreCompleted': '恢复完成。',
    'settings.security.label.detection': '检测来源',
    'settings.updates.appleDoubleHint': '这通常是旧的更新包里混入了 macOS AppleDouble 文件（`._*`）导致解包失败。',
    'settings.updates.appleDoubleAction': '已修复：请点击“检查更新”重新下载后再点“安装并重启”。',
    'setupWizard.button.createNewKey': '创建新 Key',
    'setupWizard.button.next': '下一步',
    'setupWizard.button.useAndContinue': '使用并继续',
    'setupWizard.errors.existingProfileRequired': '请先选择一个已有配置。',
    'setupWizard.errors.installFailedPrefix': '安装失败（退出码',
    'setupWizard.errors.installFailedSuffix': '）。提示：可使用“打开终端”手动运行命令。',
    'setupWizard.errors.openclawAuthProfilesNotReady': 'OpenClaw auth-profiles 尚未就绪。',
    'setupWizard.errors.telegramTokenInvalidFormat': 'Telegram bot token 格式无效。应为：123456789:ABC...',
    'setupWizard.errors.telegramTokenRequired': '请粘贴来自 @BotFather 的有效 Telegram bot token。',
    'setupWizard.existingKey.title': '选择已有 Key',
    'setupWizard.messages.saved': '已保存。',
    'setupWizard.messages.usingExistingKeyProfile': '已使用现有 Key 配置。',
    'setupWizard.mode.createNew': '创建新的',
    'setupWizard.mode.existing': '已有',
    'setupWizard.status.checkingSavedProviderSetup': '正在检查已保存的 Provider 配置...',
    'setupWizard.step3.button.skipStartChat': '暂时跳过 · 开始聊天',
    'setupWizard.telegram.button.saveConnect': '保存并连接',
    'setupWizard.telegram.button.saving': '保存中…',
    'setupWizard.telegram.guide.step1Prefix': '打开 Telegram 并进入',
    'setupWizard.telegram.guide.step1Suffix': '。',
    'setupWizard.telegram.guide.step2': '开始聊天并输入',
    'setupWizard.telegram.guide.step3': '按提示设置 bot 名称和用户名。',
    'setupWizard.telegram.guide.step4': 'BotFather 会发送 token。复制完整 token 字符串。',
    'setupWizard.telegram.guide.step5': '将 token 粘贴到下方，然后点击“保存并连接”。',
    'setupWizard.telegram.howToGetToken': '如何获取 bot token？',
    'setupWizard.telegram.label.botToken': '输入 bot token',
    'setupWizard.telegram.placeholder.botToken': '123456789:ABCdefGHIjkLMNOpqrSTUVWxyz',
    'setupWizard.telegram.title': '连接 Telegram',
    'setupWizard.telegram.videoHintPrefix': '视频教程。如果播放失败，请打开',
    'setupWizard.telegram.videoHintSuffix': '。',
    'settings.daemon.title': '守护进程',
    'settings.daemon.controlPlaneUrl': '控制平面 URL',
    'settings.daemon.gatewayUrl': '网关 URL',
    'settings.daemon.rpcAddress': 'RPC 地址',
    'settings.daemon.rpcAddressPlaceholder': '127.0.0.1:4455',
    'settings.daemon.rpcAddressHint': '应用连接守护进程 RPC 所使用的 host:port。',
    'settings.daemon.rpcToken': 'RPC 令牌',
    'settings.daemon.tokenPlaceholderSet': '已设置（留空表示不变更）',
    'settings.daemon.tokenPlaceholderPaste': '粘贴 token',
    'settings.daemon.clearSavedToken': '清除已保存 token',
    'settings.daemon.openclawHooksUrl': 'OpenClaw Hooks URL',
    'settings.daemon.openclawHooksUrlPlaceholder': 'https://example.com/hooks',
    'settings.daemon.openclawHooksUrlHint': '用于 OpenClaw webhook 回调。',
    'settings.daemon.openclawHooksToken': 'OpenClaw Hooks 令牌',
    'settings.daemon.openclawWsToken': 'OpenClaw WS 令牌',
    'settings.daemon.wsTokenHint': 'OpenClaw 网关使用的 WebSocket 鉴权 token。',
    'settings.daemon.save': '保存守护进程设置',
    'settings.daemon.saving': '保存中…',
    'settings.daemon.status.applied': '变更已应用。',
    'settings.daemon.status.noChanges': '无变更。',
    'settings.daemon.status.pairingReset': '配对令牌已重置。',
    'settings.daemon.status.restartRequired': '需要重启。',
    'settings.status.title': '状态',
    'settings.status.deviceId': '设备 ID',
    'settings.status.authenticated': '已认证',
    'settings.status.yes': '是',
    'settings.status.no': '否',
    'settings.status.daemonRpcToken': '守护进程 RPC 令牌',
    'settings.status.set': '已设置',
    'settings.status.unset': '未设置',
    'settings.status.openclawUrl': 'OpenClaw URL',
    'settings.status.openclawHooksToken': 'OpenClaw Hooks 令牌',
    'settings.status.openclawWsToken': 'OpenClaw WS 令牌',
    'settings.status.tenantUrl': '租户 URL',
  },
}

function inferInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'en'
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY)
  if (stored === 'en' || stored === 'zh') return stored
  const preferred = window.navigator.language.toLowerCase()
  return preferred.startsWith('zh') ? 'zh' : 'en'
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => inferInitialLocale())

  useEffect(() => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  }, [locale])

  const value = useMemo<LocaleContextValue>(() => {
    return {
      locale,
      setLocale,
      t: (key) => translations[locale][key as TranslationKey] ?? translations.en[key as TranslationKey] ?? key,
    }
  }, [locale])

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}
