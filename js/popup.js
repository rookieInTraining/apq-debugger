var totalPatterns = 1;

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
        setTimeout(() => {
            document.querySelector("#form-actions").removeChild(document.querySelector(".stop"))
            document.querySelector("#response").innerText = "Debugger Disconnected!!"
        }, 5000);
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