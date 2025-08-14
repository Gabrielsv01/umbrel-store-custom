function copyToken() {
    const tokenElem = document.getElementById('apiToken');
    if (navigator.clipboard) {
        navigator.clipboard.writeText(tokenElem.textContent);
    } 
    alert('Token copiado!');
}

let apiToken = null;
document.addEventListener('DOMContentLoaded', () => {
    const tokenElem = document.getElementById('apiToken');
    if (tokenElem) {
        apiToken = tokenElem.textContent;
    }
    fetchContainers();
});

function fetchContainers() {
    fetch('/api/authorized-containers', {
        headers: {
            'X-API-Token': apiToken
        }
    })
    .then(response => response.json())
    .then(containers => {
        const listElement = document.getElementById('containerList');
        listElement.innerHTML = '';
        containers.forEach(name => {
            const div = document.createElement('div');
            div.className = 'container-item';
            div.innerHTML = `
                <span>${name}</span>
                <div class="control-buttons">
                    <button onclick="controlContainer('${name}', 'start')">Start</button>
                    <button onclick="controlContainer('${name}', 'stop')">Stop</button>
                    <button onclick="removeContainer('${name}')" style="background-color: #f44336; color: white;">Remover</button>
                </div>
            `;
            listElement.appendChild(div);
        });
    });
}

function addContainer() {
    const input = document.getElementById('containerNameInput');
    const name = input.value.trim();
    if (name) {
        fetch('/api/authorized-containers', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Token': apiToken
            },
            body: JSON.stringify({ container_name: name })
        }).then(() => {
            input.value = '';
            fetchContainers();
        });
    }
}

function removeContainer(name) {
    fetch(`/api/authorized-containers/${name}`, {
        method: 'DELETE',
        headers: {
            'X-API-Token': apiToken
        }
    }).then(() => fetchContainers());
}

function controlContainer(name, action) {
    fetch(`/api/containers/${name}/${action}`, {
        method: 'POST',
        headers: {
            'X-API-Token': apiToken
        }
    })
    .then(response => response.json())
    .then(data => {
        alert(`Comando '${action}' para '${name}' - Status: ${data.status}`);
    });
}
