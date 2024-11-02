let debuggerAttached = false;
let tabId;

function isAttached(value, tab) {
  debuggerAttached = value;
  tabId = tab;
}

async function digestMessage(message) {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return hash;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.info(message)
  if(message.patterns != undefined && message.patterns.length != 0) {
    chrome.windows.getCurrent((window) => {
      chrome.tabs.query({active: true, currentWindow: true, windowId: window.id}, (tabs) => {
          let currentTab = tabs[0];
          console.info(currentTab)
          if(currentTab.url.startsWith('http')) {
              chrome.debugger.attach({tabId : currentTab.id}, '1.3', () => {
                  chrome.debugger.sendCommand(
                      {tabId: currentTab.id},
                      "Fetch.enable",
                      {patterns : message.patterns},
                      () => isAttached(true, currentTab.id)
                  );
              });
          } else {
              console.error('Debugger can only be attached to HTTP/HTTPS pages.');
          }
      })
    })
    sendResponse({status: "ENABLED", message: `Network Interception enabled for the following regex: \n ${message.patterns.map((regex) => regex.urlPattern)}`});
  } else if (message.disconnect != undefined && message.disconnect != 0) {
    if(tabId != undefined) {
      console.log(`Deatching debugger session for tab id : ${tabId}`)
      chrome.debugger.detach(
        {tabId: tabId},
        () => isAttached(false)
      )
      sendResponse({status: "DISABLED"})
    }
  } else {
    sendResponse({status: "DENIED", error: "URL cannot be empty! Try again!"});
  }
});

chrome.debugger.onEvent.addListener(async (source, method, params) => {
    if (method === 'Fetch.requestPaused') {
      console.info(params);
      if(params.request.hasPostData) {
        let reqBody = JSON.parse(params.request.postData);
        console.info(reqBody);
        if(Array.isArray(reqBody)) {
          console.log("Request payload is an array")
          reqBody.forEach((req) => {
            contaminatePayload(req);
          })
        } else {
          console.log("Request payload is a JSON element")
          contaminatePayload(reqBody)
        }
        let base64Data = btoa(
          new TextEncoder().encode(JSON.stringify(reqBody))
              .reduce((data, byte) => data + String.fromCharCode(byte), '')
        );
        console.info(`Modified Request : ${JSON.stringify(reqBody)}\nBase64 : ${base64Data}`);
        console.info("Executing Fetch.continueRequest...");
        
        chrome.debugger.sendCommand(
          {tabId: source.tabId},
          "Fetch.continueRequest",
          { requestId : params.requestId, postData : base64Data }
        );
      }
  }
});

const contaminatePayload = (payload) => {
  if(payload.query == undefined && payload.extensions != null) {
    payload.extensions.persistedQuery.sha256Hash = digestMessage('1234567890');
  } else {
    console.log(`Expected a JSON to contain APQ extensions but found : ${JSON.stringify(payload)}`)
  }
}