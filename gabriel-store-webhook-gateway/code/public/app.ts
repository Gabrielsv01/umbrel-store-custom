document.addEventListener('DOMContentLoaded', () => {
    const servicesContainer = document.getElementById('services-container');

    function redirectToLoginIfUnauthorized(status: number): boolean {
        if (status === 401) {
            window.location.href = '/';
            return true;
        }

        return false;
    }

    async function fetchAndRenderWebhooks() {
        if (!servicesContainer) {
            console.error('servicesContainer element not found');
            return;
        }

        try {
            const response = await fetch('/api/webhooks');
            if (redirectToLoginIfUnauthorized(response.status)) {
                return;
            }

            if (!response.ok) {
                throw new Error(`Erro ao carregar serviços: HTTP ${response.status}`);
            }

            const webhooks = await response.json();
            if (!Array.isArray(webhooks)) {
                throw new Error('Formato de resposta inválido em /api/webhooks');
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
        } catch (error) {
            servicesContainer.innerHTML = '<p>Erro ao carregar serviços do dashboard.</p>';
            console.error(error);
        }
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
            if (redirectToLoginIfUnauthorized(response.status)) {
                return;
            }
            if (!response.ok) {
                throw new Error(`Erro ao carregar logs: HTTP ${response.status}`);
            }

            const logs = await response.json();

            logsContainer.innerHTML = '';
            if (logs.length === 0) {
                logsContainer.innerHTML = '<p>Nenhum log encontrado para este serviço.</p>';
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
            logsContainer.innerHTML = '<p>Erro ao carregar os logs.</p>';
            console.error(error);
        }
    }

    fetchAndRenderWebhooks();
});
