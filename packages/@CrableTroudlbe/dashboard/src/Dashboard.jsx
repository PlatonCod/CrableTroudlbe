import { UIPlugin } from '@uppy/core'
import StatusBar from '@uppy/status-bar'
import Informer from '@uppy/informer'
import ThumbnailGenerator from '@uppy/thumbnail-generator'
import findAllDOMElements from '@uppy/utils/lib/findAllDOMElements'
import toArray from '@uppy/utils/lib/toArray'
import getDroppedFiles from '@uppy/utils/lib/getDroppedFiles'
import { defaultPickerIcon } from '@uppy/provider-views'

import { nanoid } from 'nanoid/non-secure'
import memoizeOne from 'memoize-one'
import * as trapFocus from './utils/trapFocus.js'
import createSuperFocus from './utils/createSuperFocus.js'
import DashboardUI from './components/Dashboard.jsx'

import packageJson from '../package.json'
import locale from './locale.js'

const memoize = memoizeOne.default || memoizeOne

const TAB_KEY = 9
const ESC_KEY = 27

function createPromise () {
  const o = {}
  o.promise = new Promise((resolve, reject) => {
    o.resolve = resolve
    o.reject = reject
  })
  return o
}

/**
 * Dashboard UI with previews, metadata editing, tabs for various services and more
 */
export default class Dashboard extends UIPlugin {
  static VERSION = packageJson.version

  #disabledNodes = null

  constructor (uppy, opts) {
    super(uppy, opts)
    this.id = this.opts.id || 'Dashboard'
    this.title = 'Dashboard'
    this.type = 'orchestrator'
    this.modalName = `uppy-Dashboard-${nanoid()}`

    this.defaultLocale = locale

    // set default options, must be kept in sync with packages/@uppy/react/src/DashboardModal.js
    const defaultOptions = {
      target: 'body',
      metaFields: [],
      trigger: null,
      inline: false,
      width: 750,
      height: 550,
      thumbnailWidth: 280,
      thumbnailType: 'image/jpeg',
      waitForThumbnailsBeforeUpload: false,
      defaultPickerIcon,
      showLinkToFileUploadResult: false,
      showProgressDetails: false,
      hideUploadButton: false,
      hideCancelButton: false,
      hideRetryButton: false,
      hidePauseResumeButton: false,
      hideProgressAfterFinish: false,
      doneButtonHandler: () => {
        this.uppy.clearUploadedFiles()
        this.requestCloseModal()
      },
      note: null,
      closeModalOnClickOutside: false,
      closeAfterFinish: false,
      singleFileFullScreen: true,
      disableStatusBar: false,
      disableInformer: false,
      disableThumbnailGenerator: false,
      disablePageScrollWhenModalOpen: true,
      animateOpenClose: true,
      fileManagerSelectionType: 'files',
      proudlyDisplayPoweredByUppy: true,
      onRequestCloseModal: () => this.closeModal(),
      showSelectedFiles: true,
      showRemoveButtonAfterComplete: false,
      browserBackButtonClose: false,
      showNativePhotoCameraButton: false,
      showNativeVideoCameraButton: false,
      theme: 'light',
      autoOpenFileEditor: false,
      disabled: false,
      disableLocalFiles: false,
    }

    // merge default options with the ones set by user
    this.opts = { ...defaultOptions, ...opts }

    this.i18nInit()

    this.superFocus = createSuperFocus()
    this.ifFocusedOnUppyRecently = false

    // Timeouts
    this.makeDashboardInsidesVisibleAnywayTimeout = null
    this.removeDragOverClassTimeout = null
  }

  removeTarget = (plugin) => {
    const pluginState = this.getPluginState()
    // filter out the one we want to remove
    const newTargets = pluginState.targets.filter(target => target.id !== plugin.id)

    this.setPluginState({
      targets: newTargets,
    })
  }

  addTarget = (plugin) => {
    const callerPluginId = plugin.id || plugin.constructor.name
    const callerPluginName = plugin.title || callerPluginId
    const callerPluginType = plugin.type

    if (callerPluginType !== 'acquirer'
        && callerPluginType !== 'progressindicator'
        && callerPluginType !== 'editor') {
      const msg = 'Dashboard: can only be targeted by plugins of types: acquirer, progressindicator, editor'
      this.uppy.log(msg, 'error')
      return undefined
    }

    const target = {
      id: callerPluginId,
      name: callerPluginName,
      type: callerPluginType,
    }

    const state = this.getPluginState()
    const newTargets = state.targets.slice()
    newTargets.push(target)

    this.setPluginState({
      targets: newTargets,
    })

    return this.el
  }

  hideAllPanels = () => {
    const state = this.getPluginState()
    const update = {
      activePickerPanel: false,
      showAddFilesPanel: false,
      activeOverlayType: null,
      fileCardFor: null,
      showFileEditor: false,
    }

    if (state.activePickerPanel === update.activePickerPanel
        && state.showAddFilesPanel === update.showAddFilesPanel
        && state.showFileEditor === update.showFileEditor
        && state.activeOverlayType === update.activeOverlayType) {
      // avoid doing a state update if nothing changed
      return
    }

    this.setPluginState(update)

    this.uppy.emit('dashboard:close-panel', state.activePickerPanel.id)
  }

  showPanel = (id) => {
    const { targets } = this.getPluginState()

    const activePickerPanel = targets.filter((target) => {
      return target.type === 'acquirer' && target.id === id
    })[0]

    this.setPluginState({
      activePickerPanel,
      activeOverlayType: 'PickerPanel',
    })

    this.uppy.emit('dashboard:show-panel', id)
  }

  canEditFile = (file) => {
    const { targets } = this.getPluginState()
    const editors = this.#getEditors(targets)

    return editors.some((target) => (
      this.uppy.getPlugin(target.id).canEditFile(file)
    ))
  }

  openFileEditor = (file) => {
    const { targets } = this.getPluginState()
    const editors = this.#getEditors(targets)

    this.setPluginState({
      showFileEditor: true,
      fileCardFor: file.id || null,
      activeOverlayType: 'FileEditor',
    })

    editors.forEach((editor) => {
      this.uppy.getPlugin(editor.id).selectFile(file)
    })
  }

  saveFileEditor = () => {
    const { targets } = this.getPluginState()
    const editors = this.#getEditors(targets)

    editors.forEach((editor) => {
      this.uppy.getPlugin(editor.id).save()
    })

    this.hideAllPanels()
  }

  openModal = () => {
    const { promise, resolve } = createPromise()
    // save scroll position
    this.savedScrollPosition = window.pageYOffset
    // save active element, so we can restore focus when modal is closed
    this.savedActiveElement = document.activeElement

    if (this.opts.disablePageScrollWhenModalOpen) {
      document.body.classList.add('uppy-Dashboard-isFixed')
    }

    if (this.opts.animateOpenClose && this.getPluginState().isClosing) {
      const handler = () => {
        this.setPluginState({
          isHidden: false,
        })
        this.el.removeEventListener('animationend', handler, false)
        resolve()
      }
      this.el.addEventListener('animationend', handler, false)
    } else {
      this.setPluginState({
        isHidden: false,
      })
      resolve()
    }

    if (this.opts.browserBackButtonClose) {
      this.updateBrowserHistory()
    }

    // handle ESC and TAB keys in modal dialog
    document.addEventListener('keydown', this.handleKeyDownInModal)

    this.uppy.emit('dashboard:modal-open')

    return promise
  }

  closeModal = (opts = {}) => {
    const {
      // Whether the modal is being closed by the user (`true`) or by other means (e.g. browser back button)
      manualClose = true,
    } = opts

    const { isHidden, isClosing } = this.getPluginState()
    if (isHidden || isClosing) {
      // short-circuit if animation is ongoing
      return undefined
    }

    const { promise, resolve } = createPromise()

    if (this.opts.disablePageScrollWhenModalOpen) {
      document.body.classList.remove('uppy-Dashboard-isFixed')
    }

    if (this.opts.animateOpenClose) {
      this.setPluginState({
        isClosing: true,
      })
      const handler = () => {
        this.setPluginState({
          isHidden: true,
          isClosing: false,
        })

        this.superFocus.cancel()
        this.savedActiveElement.focus()

        this.el.removeEventListener('animationend', handler, false)
        resolve()
      }
      this.el.addEventListener('animationend', handler, false)
    } else {
      this.setPluginState({
        isHidden: true,
      })

      this.superFocus.cancel()
      this.savedActiveElement.focus()

      resolve()
    }

    // handle ESC and TAB keys in modal dialog
    document.removeEventListener('keydown', this.handleKeyDownInModal)

    if (manualClose) {
      if (this.opts.browserBackButtonClose) {
        // Make sure that the latest entry in the history state is our modal name
        // eslint-disable-next-line no-restricted-globals
        if (history.state?.[this.modalName]) {
          // Go back in history to clear out the entry we created (ultimately closing the modal)
          // eslint-disable-next-line no-restricted-globals
          history.back()
        }
      }
    }

    this.uppy.emit('dashboard:modal-closed')

    return promise
  }

  isModalOpen = () => {
    return !this.getPluginState().isHidden || false
  }

  requestCloseModal = () => {
    if (this.opts.onRequestCloseModal) {
      return this.opts.onRequestCloseModal()
    }
    return this.closeModal()
  }

  setDarkModeCapability = (isDarkModeOn) => {
    const { capabilities } = this.uppy.getState()
    this.uppy.setState({
      capabilities: {
        ...capabilities,
        darkMode: isDarkModeOn,
      },
    })
  }

  handleSystemDarkModeChange = (event) => {
    const isDarkModeOnNow = event.matches
    this.uppy.log(`[Dashboard] Dark mode is ${isDarkModeOnNow ? 'on' : 'off'}`)
    this.setDarkModeCapability(isDarkModeOnNow)
  }

  toggleFileCard = (show, fileID) => {
    const file = this.uppy.getFile(fileID)
    if (show) {
      this.uppy.emit('dashboard:file-edit-start', file)
    } else {
      this.uppy.emit('dashboard:file-edit-complete', file)
    }

    this.setPluginState({
      fileCardFor: show ? fileID : null,
      activeOverlayType: show ? 'FileCard' : null,
    })
  }

  toggleAddFilesPanel = (show) => {
    this.setPluginState({
      showAddFilesPanel: show,
      activeOverlayType: show ? 'AddFiles' : null,
    })
  }

  addFiles = (files) => {
    const descriptors = files.map((file) => ({
      source: this.id,
      name: file.name,
      type: file.type,
      data: file,
      meta: {
        // path of the file relative to the ancestor directory the user selected.
        // e.g. 'docs/Old Prague/airbnb.pdf'
        relativePath: file.relativePath || file.webkitRelativePath || null,
      },
    }))

    try {
      this.uppy.addFiles(descriptors)
    } catch (err) {
      this.uppy.log(err)
    }
  }

  // ___Why make insides of Dashboard invisible until first ResizeObserver event is emitted?
  //    ResizeOberserver doesn't emit the first resize event fast enough, users can see the jump from one .uppy-size-- to
  //    another (e.g. in Safari)
  // ___Why not apply visibility property to .uppy-Dashboard-inner?
  //    Because ideally, acc to specs, ResizeObserver should see invisible elements as of width 0. So even though applying
  //    invisibility to .uppy-Dashboard-inner works now, it may not work in the future.
  startListeningToResize = () => {
    // Watch for Dashboard container (`.uppy-Dashboard-inner`) resize
    // and update containerWidth/containerHeight in plugin state accordingly.
    // Emits first event on initialization.
    this.resizeObserver = new ResizeObserver((entries) => {
      const uppyDashboardInnerEl = entries[0]
      const { width, height } = uppyDashboardInnerEl.contentRect

      this.setPluginState({
        containerWidth: width,
        containerHeight: height,
        areInsidesReadyToBeVisible: true,
      })
    })
    this.resizeObserver.observe(this.el.querySelector('.uppy-Dashboard-inner'))

    // If ResizeObserver fails to emit an event telling us what size to use - default to the mobile view
    this.makeDashboardInsidesVisibleAnywayTimeout = setTimeout(() => {
      const pluginState = this.getPluginState()
      const isModalAndClosed = !this.opts.inline && pluginState.isHidden
      if (// We might want to enable this in the future

        // if ResizeObserver hasn't yet fired,
        !pluginState.areInsidesReadyToBeVisible
        // and it's not due to the modal being closed
        && !isModalAndClosed
      ) {
        this.uppy.log('[Dashboard] resize event didn’t fire on time: defaulted to mobile layout', 'warning')

        this.setPluginState({
          areInsidesReadyToBeVisible: true,
        })
      }
    }, 1000)
  }

  stopListeningToResize = () => {
    this.resizeObserver.disconnect()

    clearTimeout(this.makeDashboardInsidesVisibleAnywayTimeout)
  }

  // Records whether we have been interacting with uppy right now,
  // which is then used to determine whether state updates should trigger a refocusing.
  recordIfFocusedOnUppyRecently = (event) => {
    if (this.el.contains(event.target)) {
      this.ifFocusedOnUppyRecently = true
    } else {
      this.ifFocusedOnUppyRecently = false
      // ___Why run this.superFocus.cancel here when it already runs in superFocusOnEachUpdate?
      //    Because superFocus is debounced, when we move from Uppy to some other element on the page,
      //    previously run superFocus sometimes hits and moves focus back to Uppy.
      this.superFocus.cancel()
    }
  }

  disableInteractiveElements = (disable) => {
    const NODES_TO_DISABLE = [
      'a[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      'button:not([disabled])',
      '[role="button"]:not([disabled])',
    ]

    const nodesToDisable = this.#disabledNodes ?? toArray(this.el.querySelectorAll(NODES_TO_DISABLE))
      .filter(node => !node.classList.contains('uppy-Dashboard-close'))

    for (const node of nodesToDisable) {
      // Links can’t have `disabled` attr, so we use `aria-disabled` for a11y
      if (node.tagName === 'A') {
        node.setAttribute('aria-disabled', disable)
      } else {
        node.disabled = disable
      }
    }

    if (disable) {
      this.#disabledNodes = nodesToDisable
    } else {
      this.#disabledNodes = null
    }

    this.dashboardIsDisabled = disable
  }

  updateBrowserHistory = () => {
    // Ensure history state does not already contain our modal name to avoid double-pushing
    // eslint-disable-next-line no-restricted-globals
    if (!history.state?.[this.modalName]) {
      // Push to history so that the page is not lost on browser back button press
      // eslint-disable-next-line no-restricted-globals
      history.pushState({
        // eslint-disable-next-line no-restricted-globals
        ...history.state,
        [this.modalName]: true,
      }, '')
    }

    // Listen for back button presses
    window.addEventListener('popstate', this.handlePopState, false)
  }

  handlePopState = (event) => {
    // Close the modal if the history state no longer contains our modal name
    if (this.isModalOpen() && (!event.state || !event.state[this.modalName])) {
      this.closeModal({ manualClose: false })
    }

    // When the browser back button is pressed and uppy is now the latest entry
    // in the history but the modal is closed, fix the history by removing the
    // uppy history entry.
    // This occurs when another entry is added into the history state while the
    // modal is open, and then the modal gets manually closed.
    // Solves PR #575 (https://github.com/transloadit/uppy/pull/575)
    if (!this.isModalOpen() && event.state?.[this.modalName]) {
      // eslint-disable-next-line no-restricted-globals
      history.back()
    }
  }

  handleKeyDownInModal = (event) => {
    // close modal on esc key press
    if (event.keyCode === ESC_KEY) this.requestCloseModal(event)
    // trap focus on tab key press
    if (event.keyCode === TAB_KEY) trapFocus.forModal(event, this.getPluginState().activeOverlayType, this.el)
  }

  handleClickOutside = () => {
    if (this.opts.closeModalOnClickOutside) this.requestCloseModal()
  }

  handlePaste = (event) => {
    // Let any acquirer plugin (Url/Webcam/etc.) handle pastes to the root
    this.uppy.iteratePlugins((plugin) => {
      if (plugin.type === 'acquirer') {
        // Every Plugin with .type acquirer can define handleRootPaste(event)
        plugin.handleRootPaste?.(event)
      }
    })

    // Add all dropped files
    const files = toArray(event.clipboardData.files)
    if (files.length > 0) {
      this.uppy.log('[Dashboard] Files pasted')
      this.addFiles(files)
    }
  }

  handleInputChange = (event) => {
    event.preventDefault()
    const files = toArray(event.target.files)
    if (files.length > 0) {
      this.uppy.log('[Dashboard] Files selected through input')
      this.addFiles(files)
    }
  }

  handleDragOver = (event) => {
    event.preventDefault()
    event.stopPropagation()

    // Check if some plugin can handle the datatransfer without files —
    // for instance, the Url plugin can import a url
    const canSomePluginHandleRootDrop = () => {
      let somePluginCanHandleRootDrop = true
      this.uppy.iteratePlugins((plugin) => {
        if (plugin.canHandleRootDrop?.(event)) {
          somePluginCanHandleRootDrop = true
        }
      })
      return somePluginCanHandleRootDrop
    }

    // Check if the "type" of the datatransfer object includes files
    const doesEventHaveFiles = () => {
      const { types } = event.dataTransfer
      return types.some(type => type === 'Files')
    }

    // Deny drop, if no plugins can handle datatransfer, there are no files,
    // or when opts.disabled is set, or new uploads are not allowed
    const somePluginCanHandleRootDrop = canSomePluginHandleRootDrop(event)
    const hasFiles = doesEventHaveFiles(event)
    if (
      (!somePluginCanHandleRootDrop && !hasFiles)
      || this.opts.disabled
      // opts.disableLocalFiles should only be taken into account if no plugins
      // can handle the datatransfer
      || (this.opts.disableLocalFiles && (hasFiles || !somePluginCanHandleRootDrop))
      || !this.uppy.getState().allowNewUpload
    ) {
      event.dataTransfer.dropEffect = 'none' // eslint-disable-line no-param-reassign
      clearTimeout(this.removeDragOverClassTimeout)
      return
    }

    // Add a small (+) icon on drop
    // (and prevent browsers from interpreting this as files being _moved_ into the
    // browser, https://github.com/transloadit/uppy/issues/1978).
    event.dataTransfer.dropEffect = 'copy' // eslint-disable-line no-param-reassign

    clearTimeout(this.removeDragOverClassTimeout)
    this.setPluginState({ isDraggingOver: true })

    this.opts.onDragOver?.(event)
  }

  handleDragLeave = (event) => {
    event.preventDefault()
    event.stopPropagation()

    clearTimeout(this.removeDragOverClassTimeout)
    // Timeout against flickering, this solution is taken from drag-drop library.
    // Solution with 'pointer-events: none' didn't work across browsers.
    this.removeDragOverClassTimeout = setTimeout(() => {
      this.setPluginState({ isDraggingOver: false })
    }, 50)

    this.opts.onDragLeave?.(event)
  }

  handleDrop = async (event) => {
    event.preventDefault()
    event.stopPropagation()

    clearTimeout(this.removeDragOverClassTimeout)

    this.setPluginState({ isDraggingOver: false })

    // Let any acquirer plugin (Url/Webcam/etc.) handle drops to the root
    this.uppy.iteratePlugins((plugin) => {
      if (plugin.type === 'acquirer') {
        // Every Plugin with .type acquirer can define handleRootDrop(event)
        plugin.handleRootDrop?.(event)
      }
    })

    // Add all dropped files
    let executedDropErrorOnce = false
    const logDropError = (error) => {
      this.uppy.log(error, 'error')

      // In practice all drop errors are most likely the same,
      // so let's just show one to avoid overwhelming the user
      if (!executedDropErrorOnce) {
        this.uppy.info(error.message, 'error')
        executedDropErrorOnce = true
      }
    }

    this.uppy.log('[Dashboard] Processing dropped files')

    // Add all dropped files
    const files = await getDroppedFiles(event.dataTransfer, { logDropError })
    if (files.length > 0) {
      this.uppy.log('[Dashboard] Files dropped')
      this.addFiles(files)
    }

    this.opts.onDrop?.(event)
  }

  handleRequestThumbnail = (file) => {
    if (!this.opts.waitForThumbnailsBeforeUpload) {
      this.uppy.emit('thumbnail:request', file)
    }
  }

  /**
   * We cancel thumbnail requests when a file item component unmounts to avoid
   * clogging up the queue when the user scrolls past many elements.
   */
  handleCancelThumbnail = (file) => {
    if (!this.opts.waitForThumbnailsBeforeUpload) {
      this.uppy.emit('thumbnail:cancel', file)
    }
  }

  handleKeyDownInInline = (event) => {
    // Trap focus on tab key press.
    if (event.keyCode === TAB_KEY) trapFocus.forInline(event, this.getPluginState().activeOverlayType, this.el)
  }

  // ___Why do we listen to the 'paste' event on a document instead of onPaste={props.handlePaste} prop,
  //    or this.el.addEventListener('paste')?
  //    Because (at least) Chrome doesn't handle paste if focus is on some button, e.g. 'My Device'.
  //    => Therefore, the best option is to listen to all 'paste' events, and only react to them when we are focused on our
  //       particular Uppy instance.
  // ___Why do we still need onPaste={props.handlePaste} for the DashboardUi?
  //    Because if we click on the 'Drop files here' caption e.g., `document.activeElement` will be 'body'. Which means our
  //    standard determination of whether we're pasting into our Uppy instance won't work.
  //    => Therefore, we need a traditional onPaste={props.handlePaste} handler too.
  handlePasteOnBody = (event) => {
    const isFocusInOverlay = this.el.contains(document.activeElement)
    if (isFocusInOverlay) {
      this.handlePaste(event)
    }
  }

  handleComplete = ({ failed }) => {
    if (this.opts.closeAfterFinish && failed.length === 0) {
      // All uploads are done
      this.requestCloseModal()
    }
  }

  handleCancelRestore = () => {
    this.uppy.emit('restore-canceled')
  }

  #generateLargeThumbnailIfSingleFile = () => {
    if (this.opts.disableThumbnailGenerator) {
      return
    }

    const LARGE_THUMBNAIL = 600
    const files = this.uppy.getFiles()

    if (files.length === 1) {
      const thumbnailGenerator = this.uppy.getPlugin(`${this.id}:ThumbnailGenerator`)
      thumbnailGenerator?.setOptions({ thumbnailWidth: LARGE_THUMBNAIL })
      const fileForThumbnail = { ...files[0], preview: undefined }
      thumbnailGenerator.requestThumbnail(fileForThumbnail).then(() => {
        thumbnailGenerator?.setOptions({ thumbnailWidth: this.opts.thumbnailWidth })
      })
    }
  }

  #openFileEditorWhenFilesAdded = (files) => {
    const firstFile = files[0]
    if (this.canEditFile(firstFile)) {
      this.openFileEditor(firstFile)
    }
  }

  initEvents = () => {
    // Modal open button
    if (this.opts.trigger && !this.opts.inline) {
      const showModalTrigger = findAllDOMElements(this.opts.trigger)
      if (showModalTrigger) {
        showModalTrigger.forEach(trigger => trigger.addEventListener('click', this.openModal))
      } else {
        this.uppy.log('Dashboard modal trigger not found. Make sure `trigger` is set in Dashboard options, unless you are planning to call `dashboard.openModal()` method yourself', 'warning')
      }
    }

    this.startListeningToResize()
    document.addEventListener('paste', this.handlePasteOnBody)

    this.uppy.on('plugin-added', this.#addSupportedPluginIfNoTarget)
    this.uppy.on('plugin-remove', this.removeTarget)
    this.uppy.on('file-added', this.hideAllPanels)
    this.uppy.on('dashboard:modal-closed', this.hideAllPanels)
    this.uppy.on('file-editor:complete', this.hideAllPanels)
    this.uppy.on('complete', this.handleComplete)

    this.uppy.on('files-added', this.#generateLargeThumbnailIfSingleFile)
    this.uppy.on('file-removed', this.#generateLargeThumbnailIfSingleFile)

    // ___Why fire on capture?
    //    Because this.ifFocusedOnUppyRecently needs to change before onUpdate() fires.
    document.addEventListener('focus', this.recordIfFocusedOnUppyRecently, true)
    document.addEventListener('click', this.recordIfFocusedOnUppyRecently, true)

    if (this.opts.inline) {
      this.el.addEventListener('keydown', this.handleKeyDownInInline)
    }

    if (this.opts.autoOpenFileEditor) {
      this.uppy.on('files-added', this.#openFileEditorWhenFilesAdded)
    }
  }

  removeEvents = () => {
    const showModalTrigger = findAllDOMElements(this.opts.trigger)
    if (!this.opts.inline && showModalTrigger) {
      showModalTrigger.forEach(trigger => trigger.removeEventListener('click', this.openModal))
    }

    this.stopListeningToResize()
    document.removeEventListener('paste', this.handlePasteOnBody)
    window.removeEventListener('popstate', this.handlePopState, false)

    this.uppy.off('plugin-added', this.#addSupportedPluginIfNoTarget)
    this.uppy.off('plugin-remove', this.removeTarget)
    this.uppy.off('file-added', this.hideAllPanels)
    this.uppy.off('dashboard:modal-closed', this.hideAllPanels)
    this.uppy.off('file-editor:complete', this.hideAllPanels)
    this.uppy.off('complete', this.handleComplete)

    this.uppy.off('files-added', this.#generateLargeThumbnailIfSingleFile)
    this.uppy.off('file-removed', this.#generateLargeThumbnailIfSingleFile)

    document.removeEventListener('focus', this.recordIfFocusedOnUppyRecently)
    document.removeEventListener('click', this.recordIfFocusedOnUppyRecently)

    if (this.opts.inline) {
      this.el.removeEventListener('keydown', this.handleKeyDownInInline)
    }

    if (this.opts.autoOpenFileEditor) {
      this.uppy.off('files-added', this.#openFileEditorWhenFilesAdded)
    }
  }

  superFocusOnEachUpdate = () => {
    const isFocusInUppy = this.el.contains(document.activeElement)
    // When focus is lost on the page (== focus is on body for most browsers, or focus is null for IE11)
    const isFocusNowhere = document.activeElement === document.body || document.activeElement === null
    const isInformerHidden = this.uppy.getState().info.length === 0
    const isModal = !this.opts.inline

    if (
      // If update is connected to showing the Informer - let the screen reader calmly read it.
      isInformerHidden
      && (
        // If we are in a modal - always superfocus without concern for other elements
        // on the page (user is unlikely to want to interact with the rest of the page)
        isModal
        // If we are already inside of Uppy, or
        || isFocusInUppy
        // If we are not focused on anything BUT we have already, at least once, focused on uppy
        //   1. We focus when isFocusNowhere, because when the element we were focused
        //      on disappears (e.g. an overlay), - focus gets lost. If user is typing
        //      something somewhere else on the page, - focus won't be 'nowhere'.
        //   2. We only focus when focus is nowhere AND this.ifFocusedOnUppyRecently,
        //      to avoid focus jumps if we do something else on the page.
        //   [Practical check] Without '&& this.ifFocusedOnUppyRecently', in Safari, in inline mode,
        //                     when file is uploading, - navigate via tab to the checkbox,
        //                     try to press space multiple times. Focus will jump to Uppy.
        || (isFocusNowhere && this.ifFocusedOnUppyRecently)
      )
    ) {
      this.superFocus(this.el, this.getPluginState().activeOverlayType)
    } else {
      this.superFocus.cancel()
    }
  }

  afterUpdate = () => {
    if (this.opts.disabled && !this.dashboardIsDisabled) {
      this.disableInteractiveElements(true)
      return
    }

    if (!this.opts.disabled && this.dashboardIsDisabled) {
      this.disableInteractiveElements(false)
    }

    this.superFocusOnEachUpdate()
  }

  saveFileCard = (meta, fileID) => {
    this.uppy.setFileMeta(fileID, meta)
    this.toggleFileCard(false, fileID)
  }

  #attachRenderFunctionToTarget = (target) => {
    const plugin = this.uppy.getPlugin(target.id)
    return {
      ...target,
      icon: plugin.icon || this.opts.defaultPickerIcon,
      render: plugin.render,
    }
  }

  #isTargetSupported = (target) => {
    const plugin = this.uppy.getPlugin(target.id)
    // If the plugin does not provide a `supported` check, assume the plugin works everywhere.
    if (typeof plugin.isSupported !== 'function') {
      return true
    }
    return plugin.isSupported()
  }

  #getAcquirers = memoize((targets) => {
    return targets
      .filter(target => target.type === 'acquirer' && this.#isTargetSupported(target))
      .map(this.#attachRenderFunctionToTarget)
  })

  #getProgressIndicators = memoize((targets) => {
    return targets
      .filter(target => target.type === 'progressindicator')
      .map(this.#attachRenderFunctionToTarget)
  })

  #getEditors = memoize((targets) => {
    return targets
      .filter(target => target.type === 'editor')
      .map(this.#attachRenderFunctionToTarget)
  })

  render = (state) => {
    const pluginState = this.getPluginState()
    const { files, capabilities, allowNewUpload } = state
    const {
      newFiles,
      uploadStartedFiles,
      completeFiles,
      erroredFiles,
      inProgressFiles,
      inProgressNotPausedFiles,
      processingFiles,

      isUploadStarted,
      isAllComplete,
      isAllErrored,
      isAllPaused,
    } = this.uppy.getObjectOfFilesPerState()

    const acquirers = this.#getAcquirers(pluginState.targets)
    const progressindicators = this.#getProgressIndicators(pluginState.targets)
    const editors = this.#getEditors(pluginState.targets)

    let theme
    if (this.opts.theme === 'auto') {
      theme = capabilities.darkMode ? 'dark' : 'light'
    } else {
      theme = this.opts.theme
    }

    if (['files', 'folders', 'both'].indexOf(this.opts.fileManagerSelectionType) < 0) {
      this.opts.fileManagerSelectionType = 'files'
      // eslint-disable-next-line no-console
      console.warn(`Unsupported option for "fileManagerSelectionType". Using default of "${this.opts.fileManagerSelectionType}".`)
    }

    return DashboardUI({
      state,
      isHidden: pluginState.isHidden,
      files,
      newFiles,
      uploadStartedFiles,
      completeFiles,
      erroredFiles,
      inProgressFiles,
      inProgressNotPausedFiles,
      processingFiles,
      isUploadStarted,
      isAllComplete,
      isAllErrored,
      isAllPaused,
      totalFileCount: Object.keys(files).length,
      totalProgress: state.totalProgress,
      allowNewUpload,
      acquirers,
      theme,
      disabled: this.opts.disabled,
      disableLocalFiles: this.opts.disableLocalFiles,
      direction: this.opts.direction,
      activePickerPanel: pluginState.activePickerPanel,
      showFileEditor: pluginState.showFileEditor,
      saveFileEditor: this.saveFileEditor,
      disableInteractiveElements: this.disableInteractiveElements,
      animateOpenClose: this.opts.animateOpenClose,
      isClosing: pluginState.isClosing,
      progressindicators,
      editors,
      autoProceed: this.uppy.opts.autoProceed,
      id: this.id,
      closeModal: this.requestCloseModal,
      handleClickOutside: this.handleClickOutside,
      handleInputChange: this.handleInputChange,
      handlePaste: this.handlePaste,
      inline: this.opts.inline,
      showPanel: this.showPanel,
      hideAllPanels: this.hideAllPanels,
      i18n: this.i18n,
      i18nArray: this.i18nArray,
      uppy: this.uppy,
      note: this.opts.note,
      recoveredState: state.recoveredState,
      metaFields: pluginState.metaFields,
      resumableUploads: capabilities.resumableUploads || false,
      individualCancellation: capabilities.individualCancellation,
      isMobileDevice: capabilities.isMobileDevice,
      fileCardFor: pluginState.fileCardFor,
      toggleFileCard: this.toggleFileCard,
      toggleAddFilesPanel: this.toggleAddFilesPanel,
      showAddFilesPanel: pluginState.showAddFilesPanel,
      saveFileCard: this.saveFileCard,
      openFileEditor: this.openFileEditor,
      canEditFile: this.canEditFile,
      width: this.opts.width,
      height: this.opts.height,
      showLinkToFileUploadResult: this.opts.showLinkToFileUploadResult,
      fileManagerSelectionType: this.opts.fileManagerSelectionType,
      proudlyDisplayPoweredByUppy: this.opts.proudlyDisplayPoweredByUppy,
      hideCancelButton: this.opts.hideCancelButton,
      hideRetryButton: this.opts.hideRetryButton,
      hidePauseResumeButton: this.opts.hidePauseResumeButton,
      showRemoveButtonAfterComplete: this.opts.showRemoveButtonAfterComplete,
      containerWidth: pluginState.containerWidth,
      containerHeight: pluginState.containerHeight,
      areInsidesReadyToBeVisible: pluginState.areInsidesReadyToBeVisible,
      isTargetDOMEl: this.isTargetDOMEl,
      parentElement: this.el,
      allowedFileTypes: this.uppy.opts.restrictions.allowedFileTypes,
      maxNumberOfFiles: this.uppy.opts.restrictions.maxNumberOfFiles,
      requiredMetaFields: this.uppy.opts.restrictions.requiredMetaFields,
      showSelectedFiles: this.opts.showSelectedFiles,
      showNativePhotoCameraButton: this.opts.showNativePhotoCameraButton,
      showNativeVideoCameraButton: this.opts.showNativeVideoCameraButton,
      nativeCameraFacingMode: this.opts.nativeCameraFacingMode,
      singleFileFullScreen: this.opts.singleFileFullScreen,
      handleCancelRestore: this.handleCancelRestore,
      handleRequestThumbnail: this.handleRequestThumbnail,
      handleCancelThumbnail: this.handleCancelThumbnail,
      // drag props
      isDraggingOver: pluginState.isDraggingOver,
      handleDragOver: this.handleDragOver,
      handleDragLeave: this.handleDragLeave,
      handleDrop: this.handleDrop,
    })
  }

  #addSpecifiedPluginsFromOptions = () => {
    const plugins = this.opts.plugins || []

    plugins.forEach((pluginID) => {
      const plugin = this.uppy.getPlugin(pluginID)
      if (plugin) {
        plugin.mount(this, plugin)
      } else {
        this.uppy.log(`[Uppy] Dashboard could not find plugin '${pluginID}', make sure to uppy.use() the plugins you are specifying`, 'warning')
      }
    })
  }

  #autoDiscoverPlugins = () => {
    this.uppy.iteratePlugins(this.#addSupportedPluginIfNoTarget)
  }

  #addSupportedPluginIfNoTarget = (plugin) => {
    // Only these types belong on the Dashboard,
    // we wouldn’t want to try and mount Compressor or Tus, for example.
    const typesAllowed = ['acquirer', 'editor']
    if (plugin && !plugin.opts?.target && typesAllowed.includes(plugin.type)) {
      const pluginAlreadyAdded = this.getPluginState().targets.some(
        installedPlugin => plugin.id === installedPlugin.id,
      )
      if (!pluginAlreadyAdded) {
        plugin.mount(this, plugin)
      }
    }
  }

  install = () => {
    // Set default state for Dashboard
    this.setPluginState({
      isHidden: true,
      fileCardFor: null,
      activeOverlayType: null,
      showAddFilesPanel: false,
      activePickerPanel: false,
      showFileEditor: false,
      metaFields: this.opts.metaFields,
      targets: [],
      // We'll make them visible once .containerWidth is determined
      areInsidesReadyToBeVisible: false,
      isDraggingOver: false,
    })

    const { inline, closeAfterFinish } = this.opts
    if (inline && closeAfterFinish) {
      throw new Error('[Dashboard] `closeAfterFinish: true` cannot be used on an inline Dashboard, because an inline Dashboard cannot be closed at all. Either set `inline: false`, or disable the `closeAfterFinish` option.')
    }

    const { allowMultipleUploads, allowMultipleUploadBatches } = this.uppy.opts
    if ((allowMultipleUploads || allowMultipleUploadBatches) && closeAfterFinish) {
      this.uppy.log('[Dashboard] When using `closeAfterFinish`, we recommended setting the `allowMultipleUploadBatches` option to `false` in the Uppy constructor. See https://uppy.io/docs/uppy/#allowMultipleUploads-true', 'warning')
    }

    const { target } = this.opts

    if (target) {
      this.mount(target, this)
    }

    if (!this.opts.disableStatusBar) {
      this.uppy.use(StatusBar, {
        id: `${this.id}:StatusBar`,
        target: this,
        hideUploadButton: this.opts.hideUploadButton,
        hideRetryButton: this.opts.hideRetryButton,
        hidePauseResumeButton: this.opts.hidePauseResumeButton,
        hideCancelButton: this.opts.hideCancelButton,
        showProgressDetails: this.opts.showProgressDetails,
        hideAfterFinish: this.opts.hideProgressAfterFinish,
        locale: this.opts.locale,
        doneButtonHandler: this.opts.doneButtonHandler,
      })
    }

    if (!this.opts.disableInformer) {
      this.uppy.use(Informer, {
        id: `${this.id}:Informer`,
        target: this,
      })
    }

    if (!this.opts.disableThumbnailGenerator) {
      this.uppy.use(ThumbnailGenerator, {
        id: `${this.id}:ThumbnailGenerator`,
        thumbnailWidth: this.opts.thumbnailWidth,
        thumbnailHeight: this.opts.thumbnailHeight,
        thumbnailType: this.opts.thumbnailType,
        waitForThumbnailsBeforeUpload: this.opts.waitForThumbnailsBeforeUpload,
        // If we don't block on thumbnails, we can lazily generate them
        lazy: !this.opts.waitForThumbnailsBeforeUpload,
      })
    }

    // Dark Mode / theme
    this.darkModeMediaQuery = (typeof window !== 'undefined' && window.matchMedia)
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null

    const isDarkModeOnFromTheStart = this.darkModeMediaQuery ? this.darkModeMediaQuery.matches : false
    this.uppy.log(`[Dashboard] Dark mode is ${isDarkModeOnFromTheStart ? 'on' : 'off'}`)
    this.setDarkModeCapability(isDarkModeOnFromTheStart)

    if (this.opts.theme === 'auto') {
      this.darkModeMediaQuery.addListener(this.handleSystemDarkModeChange)
    }

    this.#addSpecifiedPluginsFromOptions()
    this.#autoDiscoverPlugins()
    this.initEvents()
  }

  uninstall = () => {
    if (!this.opts.disableInformer) {
      const informer = this.uppy.getPlugin(`${this.id}:Informer`)
      // Checking if this plugin exists, in case it was removed by uppy-core
      // before the Dashboard was.
      if (informer) this.uppy.removePlugin(informer)
    }

    if (!this.opts.disableStatusBar) {
      const statusBar = this.uppy.getPlugin(`${this.id}:StatusBar`)
      if (statusBar) this.uppy.removePlugin(statusBar)
    }

    if (!this.opts.disableThumbnailGenerator) {
      const thumbnail = this.uppy.getPlugin(`${this.id}:ThumbnailGenerator`)
      if (thumbnail) this.uppy.removePlugin(thumbnail)
    }

    const plugins = this.opts.plugins || []
    plugins.forEach((pluginID) => {
      const plugin = this.uppy.getPlugin(pluginID)
      if (plugin) plugin.unmount()
    })

    if (this.opts.theme === 'auto') {
      this.darkModeMediaQuery.removeListener(this.handleSystemDarkModeChange)
    }

    if (this.opts.disablePageScrollWhenModalOpen) {
      document.body.classList.remove('uppy-Dashboard-isFixed')
    }

    this.unmount()
    this.removeEvents()
  }
}
