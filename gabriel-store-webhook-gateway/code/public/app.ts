document.addEventListener('DOMContentLoaded', () => {
    const servicesContainer = document.getElementById('services-container');

    async function fetchAndRenderWebhooks() {
        const response = await fetch('/api/webhooks');
        const webhooks = await response.json();

        if (!servicesContainer) {
            console.error('servicesContainer element not found');
            return;
        }

        webhooks.forEach(webhook => {
            const serviceCard = document.createElement('div');
            serviceCard.className = 'service-card';
            serviceCard.innerHTML = `
                <div class="service-summary">
                    <h3>api/${webhook.name}</h3>
                    <span class="expand-icon">›</span>
                </div>
                <div class="service-details" style="display: none;">
                    <div class="controls-container">
                        <div>
                            <label for="log-limit-${webhook.name}">Qtd. de Logs:</label>
                            <input type="number" id="log-limit-${webhook.name}" class="log-limit-input" value="10" min="1">
                        </div>
                        <button class="fetch-logs-button" data-service-name="${webhook.name}">Atualizar Logs</button>
                    </div>
                    <div id="logs-for-${webhook.name}" class="logs-container"></div>
                </div>
            `;
            servicesContainer.appendChild(serviceCard);

            const summary = serviceCard.querySelector('.service-summary');
            const details = serviceCard.querySelector('.service-details') as HTMLElement;
            const fetchButton = serviceCard.querySelector('.fetch-logs-button') as HTMLButtonElement;
            const logLimitInput = serviceCard.querySelector('.log-limit-input') as HTMLInputElement;

            if (summary) {
                summary.addEventListener('click', () => {
                    details.classList.toggle('expanded');
                    const isExpanded = details.style.display === 'block';
                    details.style.display = isExpanded ? 'none' : 'block';
                    if (!isExpanded) {
                        fetchAndDisplayLogs(webhook.name, parseInt(logLimitInput.value));
                    }
                });
            }

            fetchButton.addEventListener('click', () => {
                fetchAndDisplayLogs(webhook.name, parseInt(logLimitInput.value));
            });
        });
    }

    async function fetchAndDisplayLogs(serviceName: string, limit: number) {
        const logsContainer = document.getElementById(`logs-for-${serviceName}`);
        if (!logsContainer) {
            console.error(`Logs container for service "${serviceName}" not found.`);
            return;
        }
        logsContainer.innerHTML = 'Carregando logs...';

        try {
            const response = await fetch(`/api/logs/${serviceName}?limit=${limit}`);
            const logs = await response.json();
            
            logsContainer.innerHTML = '';
            if (logs.length === 0) {
                logsContainer.innerHTML = `<p>Nenhum log encontrado para este serviço.</p>`;
                return;
            }

            logs.forEach(log => {
                const logCard = document.createElement('div');
                logCard.className = 'log-card';
                logCard.innerHTML = `
                    <div class="log-summary">
                        <div class="status-indicator status-${log.status}"></div>
                        <div class="log-info">
                            <strong>Status:</strong> ${log.status.toUpperCase()}
                            <span class="timestamp">${new Date(log.timestamp).toLocaleString()}</span>
                        </div>
                    </div>
                    <div class="log-details">
                        <pre>${JSON.stringify(log.payload, null, 2)}</pre>
                    </div>
                `;

                const summaryElement = logCard.querySelector('.log-summary') as HTMLElement;
                const detailsElement = logCard.querySelector('.log-details') as HTMLElement;

                summaryElement.onclick = () => {
                    detailsElement.style.display = detailsElement.style.display === 'none' ? 'block' : 'none';
                };
                detailsElement.style.display = 'none';
                logsContainer.appendChild(logCard);
            });
        } catch (error) {
            logsContainer.innerHTML = `<p>Erro ao carregar os logs.</p>`;
        }
    }

    fetchAndRenderWebhooks();
});