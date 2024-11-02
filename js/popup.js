var totalPatterns = 1;
var totalInterception = 0;

document.getElementById("add").addEventListener('click', (e) => {
    console.log("Captured click event.....");
    let formGroup = document.createElement("div");
    formGroup.setAttribute('class', 'form-group');

    console.log("Form element created.....");
    
    let newFormInput = document.createElement("input");
    newFormInput.setAttribute('type', 'text');
    newFormInput.setAttribute('class', 'urlPattern');
    newFormInput.setAttribute('data-pattern-index', ++totalPatterns);
    newFormInput.setAttribute('placeholder', 'Pattern To Match');
    
    console.log("Input element created.....");
    
    let removeButton = document.createElement("button");
    removeButton.setAttribute('type', 'button');
    removeButton.setAttribute('class', 'remove');
    removeButton.innerText = "Remove";
    removeButton.addEventListener('click', (e) => {
        console.log(e);
        document.querySelector("#myForm").removeChild(e.target.parentElement);
    });

    formGroup.appendChild(newFormInput);
    formGroup.appendChild(removeButton);
    document.querySelector("#myForm").appendChild(formGroup);
    
    console.log("New form element appended.....");
})

var addStopButton = () => {
    let stopDebugger = document.createElement("button");
    stopDebugger.setAttribute('type', 'button');
    stopDebugger.setAttribute('class', 'stop');
    stopDebugger.innerText = "Stop";
    document.querySelector("#form-actions").appendChild(stopDebugger);
    stopDebugger.addEventListener('click', (e) => {
        console.log(e);
        document.querySelector("#response").innerText = "Disconnecting Debugger...."
        const dataToSend = {disconnect: true}
        chrome.runtime.sendMessage(dataToSend, (response) => {
            console.log(response);
        })
    });
}

document.getElementById('form-submit').addEventListener('click', (e) => {
    e.preventDefault(); // Prevent actual form submission

    const urlPatterns = [];
    const formGroups = document.querySelectorAll('.form-group');
    formGroups.forEach((d) => {
        var extVal = d.querySelector('.urlPattern').value;
        urlPatterns.push({urlPattern: extVal, requestType: 'XHR', requestStage: 'Request'});
    });

    const dataToSend = { patterns: urlPatterns }

    // Send data to service worker
    if (chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(dataToSend, (response) => {
            console.log('Response from service worker:', response);

            let isPresent = document.getElementById('response');
            if(!isPresent) {
                let data = document.createElement("p");
                data.setAttribute('id', 'response');
                data.innerText = JSON.stringify(response.message);
                document.body.appendChild(data);
            } else {
                isPresent.innerText = JSON.stringify(response.message);
            }
            addStopButton()
        });
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.status === 'INTERCEPTED') {
      // Update the UI (e.g., add the information to a div)
      let outputElement = document.getElementById('interception-counter');
      if (outputElement) {
        outputElement.textContent = ++totalInterception;
      }
  
      // Optionally, send a response back to the sender
      sendResponse({ status: 'Message received' });
    }
});

chrome.debugger.onDetach.addListener((source, reason) => {
    console.log(`Debugger detached from tab ID ${source.tabId}. Reason: ${reason}`);
  
    // Additional actions when the debugger is disconnected
    if (reason === 'target_closed') {
      console.log('The target tab was closed.');
    } else if (reason === 'canceled_by_user') {
      console.log('The debugging session was manually detached by the user.');
    } else {
      console.log('Debugger detached for an unknown reason.');
    }

    document.querySelector("#form-actions").removeChild(document.querySelector(".stop"))
    document.querySelector("#response").innerText = "Debugger Disconnected!!"
});