const wdio = require('webdriverio');
const fs = require('fs-extra');
const { dirname } = require('path');

const {
  REMOTE_HOST,
  REMOTE_PORT,
  ENABLE_VIDEO,
  ENABLE_VNC,
  CI,
  CI_COMMIT_REF_NAME,
  CI_COMMIT_SHA,
  HEARTBEAT
} = process.env;

let _capabilitiesExtra = null;

function capabilitiesExtra(target) {
  if (_capabilitiesExtra === null) {
    const jsonPath = `${process.cwd()}/appium-caps.json`;
    if (fs.existsSync(jsonPath)) {
      _capabilitiesExtra = require(jsonPath);
    } else {
      _capabilitiesExtra = {};
    }
  }

  return _capabilitiesExtra[target] || {}
}

// global var, to prevent closing search engine choose several times
let _defaultSearchEnginePopupDisabled = false;


module.exports = {
  // Send heartbeats to prevent Selenium server killing process due to timeout
  heartbeatInterval: parseInt(HEARTBEAT) || 30 * 1000,
  heartbeats: {},

  // Multiple browsers support
  isMultiBrowser: true,

  // Keep track of opened browsers
  browsers: {},

  // Required - must be implemented
  // Browser control
  /**
   * @param {String} target - <browserName@browserVersion>:<platformName>:<deviceName>
   * e.g. chrome:linux
   * e.g. chrome:android:nx505j
   */
  async openBrowser(id, pageUrl, target) {
    if (!target) throw new Error('Browser name must be specified!');
    let [browserString, platformName, deviceName] = target.split(':');
    let [browserName, browserVersion] = browserString.split('@');
    let enableVideo = ENABLE_VIDEO === 'true';
    let enableVNC = ENABLE_VNC === 'true';

    let capabilities = {
      browserName,
      browserVersion,
      platformName,
      'appium:deviceName': deviceName,
      'selenoid:options': {
        enableVideo,
        enableVNC
      }
    };

    Object.assign(capabilities, capabilitiesExtra(target));

    // Set video name for CI
    if (CI && enableVideo) {
      capabilities.videoName = `test-${new Date().toISOString()}-${CI_COMMIT_REF_NAME}-${CI_COMMIT_SHA.slice(0, 8)}.mp4`
    }
    let browser = await wdio.remote({
      capabilities,
      port: parseInt(REMOTE_PORT) || 4444,
      hostname: REMOTE_HOST.trim(),
      logLevel: CI ? 'silent' : 'error'
    });

    if (!_defaultSearchEnginePopupDisabled) {
      await _chooseDefaultSearchEngine(browser);
    }
    // ! not awaited, if awaited had problems with heartbeat
    // chromedriver closes session due to inactivity
    browser.navigateTo(pageUrl);

    this.browsers[id] = browser;
    this.heartbeats[id] = setInterval(() => {
      if (!this.heartbeats[id]) return;
      browser.getTitle().catch(() => {}); // suppress error
    }, this.heartbeatInterval);
  },



  async closeBrowser(id) {
    await this.browsers[id].deleteSession();
    delete this.browsers[id];
    clearInterval(this.heartbeats[id]);
    delete this.heartbeats[id];
  },


  // Optional - implement methods you need, remove other methods
  // Initialization
  async init() {
    return;
  },

  async dispose() {
    return;
  },

  // Browser names handling
  async getBrowserList() {
    throw new Error('Not implemented!');
  },

  async isValidBrowserName(/* browserName */) {
    return true;
  },

  // Extra methods
  async resizeWindow(/* id, width, height, currentWidth, currentHeight */) {
    this.reportWarning('The window resize functionality is not supported.');
  },

  async takeScreenshot(id, screenshotPath /*, pageWidth, pageHeight */) {
    // for some reason webdriverio stopped creating folder for screenshots
    await fs.ensureDir(dirname(screenshotPath));

    return this.browsers[id].saveScreenshot(screenshotPath);
  }
};

async function _chooseDefaultSearchEngine(browser){
  await browser.switchContext('NATIVE_APP');

  // Try to locate Google search engine, if no switch context back and return
  const testElements = await browser.findElements('xpath','//*[@*="Google"]');
  if (testElements.length == 0) {
    console.warn('No Default search popup, or no Goolge option');
    // disable it, because we've done all we could anyway
    _defaultSearchEnginePopupDisabled = true;
    await browser.switchContext('CHROMIUM');
    return
  }

  //it finds by name attribute not(@* - which is any attr), but my xpath no is so strong
  const optRef = await browser.findElement('xpath','//*[@*="Google"]');
  const okRef = await browser.findElement('xpath','//*[@*="OK"]');

  await browser.elementClick(optRef.ELEMENT);
  await browser.elementClick(okRef.ELEMENT);

  await browser.switchContext('CHROMIUM');
  _defaultSearchEnginePopupDisabled = true;
}
