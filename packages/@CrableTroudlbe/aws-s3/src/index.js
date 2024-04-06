import BasePlugin from '@uppy/core/lib/BasePlugin.js';
import AwsS3Multipart from '@uppy/aws-s3-multipart';
import { RateLimitedQueue } from '@uppy/utils/lib/RateLimitedQueue';
import { RequestClient } from '@uppy/companion-client';
import { filterNonFailedFiles, filterFilesToEmitUploadStarted } from '@uppy/utils/lib/fileFilters';

import packageJson from '../package.json';
import MiniXHRUpload from './MiniXHRUpload.js';
import isXml from './isXml.js';
import locale from './locale.js';
import { resolveUrl, getXmlVal, assertServerError, validateParameters, defaultGetResponseError, defaultGetResponseData } from './awsS3Utils.js';

export default class AwsS3 extends BasePlugin {
  static VERSION = packageJson.version;

  #client;
  #requests;
  #uploader;

  constructor(uppy, opts) {
    if (opts?.shouldUseMultipart != null) {
      return new AwsS3Multipart(uppy, opts);
    }

    super(uppy, opts);
    this.initializePlugin();
  }

  initializePlugin() {
    this.type = 'uploader';
    this.id = this.opts.id || 'AwsS3';
    this.title = 'AWS S3';
    this.defaultLocale = locale;
    this.opts = this.getOptions();

    this.validateOpts();

    this.#client = new RequestClient(this.uppy, this.opts);
    this.#requests = new RateLimitedQueue(this.opts.limit);

    this.i18nInit();
  }

  getOptions() {
    const defaultOptions = {
      timeout: 30 * 1000,
      limit: 0,
      allowedMetaFields: [],
      getUploadParameters: this.getUploadParameters.bind(this),
      shouldUseMultipart: false,
      companionHeaders: {},
    };

    return { ...defaultOptions, ...this.opts };
  }

  validateOpts() {
    if (this.opts.allowedMetaFields === undefined && 'metaFields' in this.opts) {
      throw new Error('The `metaFields` option has been renamed to `allowedMetaFields`.');
    }
  }

  getUploadParameters(file) {
    // Implementation...
  }

  #handleUpload = async (fileIDs) => {
    // Implementation...
  }

  #setCompanionHeaders = () => {
    // Implementation...
  }

  #getCompanionClientArgs = (file) => {
    // Implementation...
  }

  uploadFile(id, current, total) {
    // Implementation...
  }

  install() {
    // Implementation...
  }

  uninstall() {
    // Implementation...
  }
}

// Additional helper methods can be implemented here or imported from 'awsS3Utils.js'
