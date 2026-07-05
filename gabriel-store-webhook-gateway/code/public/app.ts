type WebhookService = {
    name: string;
    endpoint: string;
};

type WebhookLog = {
    timestamp: string;
    service: string;
    status: string;
    summary: string;
    payload: unknown;
    details?: string;
};

type StatusTone = 'forwarded' | 'warn' | 'failed';

const WARN_STATUSES = new Set(['filtered', 'method_not_allowed', 'subpath_not_allowed', 'unauthorized']);

const state = {
    services: [] as WebhookService[],
    logsByService: new Map<string, WebhookLog[]>(),
    selectedService: '' as string,
    statusFilter: 'all',
    textFilter: '',
    serviceFilter: '',
    logLimit: 50,
    autoRefreshTimer: null as number | null,
};

const servicesContainer = document.getElementById('services-container') as HTMLDivElement;
const logsContainer = document.getElementById('logs-container') as HTMLDivElement;
const endpointStatsContainer = document.getElementById('endpoint-stats') as HTMLDivElement;
const selectedTitle = document.getElementById('selected-endpoint-title') as HTMLHeadingElement;
const selectedSubtitle = document.getElementById('selected-endpoint-subtitle') as HTMLParagraphElement;
const kpiServices = document.getElementById('kpi-services') as HTMLParagraphElement;
const kpiEvents = document.getElementById('kpi-events') as HTMLParagraphElement;
const kpiSuccessRate = document.getElementById('kpi-success-rate') as HTMLParagraphElement;
const kpiRiskRate = document.getElementById('kpi-risk-rate') as HTMLParagraphElement;
const lastUpdated = document.getElementById('last-updated') as HTMLSpanElement;

const refreshButton = document.getElementById('refresh-button') as HTMLButtonElement;
const autoRefreshInput = document.getElementById('auto-refresh') as HTMLInputElement;
const globalLogLimit = document.getElementById('global-log-limit') as HTMLSelectElement;
const statusFilterSelect = document.getElementById('status-filter') as HTMLSelectElement;
const textFilterInput = document.getElementById('log-search') as HTMLInputElement;
const serviceFilterInput = document.getElementById('service-search') as HTMLInputElement;

function redirectToLoginIfUnauthorized(status: number): boolean {
    if (status !== 401) {
        return false;
    }

    window.location.href = '/';
    return true;
}

async function apiGetJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (redirectToLoginIfUnauthorized(response.status)) {
        throw new Error('Usuário não autorizado');
    }

    if (!response.ok) {
        throw new Error(`Erro em ${url}: HTTP ${response.status}`);
    }

    return response.json() as Promise<T>;
}

function getStatusTone(status: string): StatusTone {
    if (status === 'forwarded') {
        return 'forwarded';
    }

    if (WARN_STATUSES.has(status)) {
        return 'warn';
    }

    return 'failed';
}

function getBadgeClass(status: string): string {
    if (status === 'forwarded') return 'badge-forwarded';
    if (WARN_STATUSES.has(status)) return `badge-${status}`;
    if (status === 'failed' || status === 'unknown_service') return `badge-${status}`;
    return 'badge-default';
}

function createElement<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    if (className) {
        element.className = className;
    }
    if (text !== undefined) {
        element.textContent = text;
    }
    return element;
}

function formatPercent(value: number): string {
    return `${Math.round(value)}%`;
}

function getAllLogs(): WebhookLog[] {
    return Array.from(state.logsByService.values()).flat();
}

function computeServiceStats(logs: WebhookLog[]) {
    const total = logs.length;
    const forwarded = logs.filter((log) => log.status === 'forwarded').length;
    const risk = logs.filter((log) => log.status !== 'forwarded').length;
    const latest = logs[0];
    const successRate = total === 0 ? 0 : (forwarded / total) * 100;

    return { total, forwarded, risk, latest, successRate };
}

function renderGlobalStats() {
    const allLogs = getAllLogs();
    const totalEvents = allLogs.length;
    const successfulEvents = allLogs.filter((log) => log.status === 'forwarded').length;
    const riskEvents = totalEvents - successfulEvents;

    kpiServices.textContent = String(state.services.length);
    kpiEvents.textContent = String(totalEvents);
    kpiSuccessRate.textContent = formatPercent(totalEvents === 0 ? 0 : (successfulEvents / totalEvents) * 100);
    kpiRiskRate.textContent = formatPercent(totalEvents === 0 ? 0 : (riskEvents / totalEvents) * 100);
}

function renderServiceList() {
    servicesContainer.innerHTML = '';

    const normalizedFilter = state.serviceFilter.trim().toLowerCase();
    const filteredServices = state.services.filter((service) => {
        if (!normalizedFilter) {
            return true;
        }

        const endpointName = `api/${service.name}`.toLowerCase();
        return endpointName.includes(normalizedFilter);
    });

    if (filteredServices.length === 0) {
        const empty = createElement('p', 'empty', 'Nenhum endpoint encontrado para esse filtro.');
        servicesContainer.appendChild(empty);
        return;
    }

    filteredServices.forEach((service) => {
        const logs = state.logsByService.get(service.name) || [];
        const stats = computeServiceStats(logs);
        const latestStatus = stats.latest?.status || 'sem_logs';

        const card = createElement('button', `service-item ${state.selectedService === service.name ? 'active' : ''}`) as HTMLButtonElement;
        card.type = 'button';

        const top = createElement('div', 'service-main');
        top.appendChild(createElement('span', 'service-endpoint', `api/${service.name}`));

        const badge = createElement('span', `badge ${getBadgeClass(latestStatus)}`, latestStatus);
        top.appendChild(badge);

        const meta = createElement('div', 'service-meta');
        meta.appendChild(createElement('span', 'chip', `Eventos: ${stats.total}`));
        meta.appendChild(createElement('span', 'chip', `Sucesso: ${formatPercent(stats.successRate)}`));

        card.appendChild(top);
        card.appendChild(meta);
        card.addEventListener('click', () => {
            state.selectedService = service.name;
            renderServiceList();
            renderSelectedService();
        });

        servicesContainer.appendChild(card);
    });
}

function renderEndpointStats(logs: WebhookLog[]) {
    const total = logs.length;
    const forwarded = logs.filter((log) => log.status === 'forwarded').length;
    const blocked = logs.filter((log) => WARN_STATUSES.has(log.status)).length;
    const failed = logs.filter((log) => !WARN_STATUSES.has(log.status) && log.status !== 'forwarded').length;

    const stats = [
        { label: 'Eventos', value: String(total) },
        { label: 'Forwarded', value: String(forwarded) },
        { label: 'Bloqueados', value: String(blocked) },
        { label: 'Falhas', value: String(failed) },
    ];

    endpointStatsContainer.innerHTML = '';
    stats.forEach((stat) => {
        const card = createElement('article', 'stat-card');
        card.appendChild(createElement('p', 'stat-label', stat.label));
        card.appendChild(createElement('p', 'stat-value', stat.value));
        endpointStatsContainer.appendChild(card);
    });
}

function renderTimeline(logs: WebhookLog[]) {
    logsContainer.innerHTML = '';
    if (logs.length === 0) {
        logsContainer.appendChild(createElement('p', 'empty', 'Sem eventos para os filtros atuais.'));
        return;
    }

    logs.forEach((log) => {
        const item = createElement('details', 'log-item');
        const summary = createElement('summary');

        const dot = createElement('span', `badge ${getBadgeClass(log.status)}`, log.status);
        const main = createElement('div', 'log-main');
        main.appendChild(createElement('span', 'log-summary-text', log.summary || 'Evento sem resumo'));
        if (log.details) {
            main.appendChild(createElement('span', 'muted', log.details));
        }

        const timestamp = createElement('span', 'timestamp', new Date(log.timestamp).toLocaleString());
        summary.appendChild(dot);
        summary.appendChild(main);
        summary.appendChild(timestamp);

        const payload = createElement('pre', 'log-payload');
        payload.textContent = JSON.stringify(log.payload, null, 2);

        item.appendChild(summary);
        item.appendChild(payload);
        logsContainer.appendChild(item);
    });
}

function renderSelectedService() {
    const serviceName = state.selectedService;
    if (!serviceName) {
        selectedTitle.textContent = 'Selecione um endpoint';
        selectedSubtitle.textContent = 'Clique em um endpoint para abrir a timeline.';
        endpointStatsContainer.innerHTML = '';
        logsContainer.innerHTML = '';
        logsContainer.appendChild(createElement('p', 'empty', 'Selecione um endpoint na coluna da esquerda.'));
        return;
    }

    const allLogs = state.logsByService.get(serviceName) || [];
    const filtered = allLogs.filter((log) => {
        if (state.statusFilter !== 'all' && log.status !== state.statusFilter) {
            return false;
        }

        const text = `${log.summary || ''} ${log.details || ''}`.toLowerCase();
        if (state.textFilter && !text.includes(state.textFilter.toLowerCase())) {
            return false;
        }

        return true;
    });

    selectedTitle.textContent = `api/${serviceName}`;
    selectedSubtitle.textContent = `${filtered.length} evento(s) exibido(s) de ${allLogs.length} carregados.`;

    renderEndpointStats(allLogs);
    renderTimeline(filtered);
}

async function refreshAllData() {
    try {
        refreshButton.disabled = true;

        const services = await apiGetJson<WebhookService[]>('/api/webhooks');
        state.services = Array.isArray(services) ? services : [];

        const logsResults = await Promise.all(
            state.services.map(async (service) => {
                const logs = await apiGetJson<WebhookLog[]>(`/api/logs/${service.name}?limit=${state.logLimit}`);
                const normalizedLogs = Array.isArray(logs) ? logs : [];
                normalizedLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                return [service.name, normalizedLogs] as const;
            }),
        );

        state.logsByService = new Map(logsResults);

        if (!state.selectedService && state.services.length > 0) {
            state.selectedService = state.services[0].name;
        }

        if (state.selectedService && !state.services.some((service) => service.name === state.selectedService)) {
            state.selectedService = state.services[0]?.name || '';
        }

        renderGlobalStats();
        renderServiceList();
        renderSelectedService();
        lastUpdated.textContent = `Atualizado em ${new Date().toLocaleTimeString()}`;
    } catch (error) {
        console.error(error);
        logsContainer.innerHTML = '';
        logsContainer.appendChild(createElement('p', 'empty', 'Falha ao carregar dados do dashboard.'));
    } finally {
        refreshButton.disabled = false;
    }
}

function setupAutoRefresh(enabled: boolean) {
    if (state.autoRefreshTimer) {
        window.clearInterval(state.autoRefreshTimer);
        state.autoRefreshTimer = null;
    }

    if (!enabled) {
        return;
    }

    state.autoRefreshTimer = window.setInterval(() => {
        void refreshAllData();
    }, 10000);
}

refreshButton.addEventListener('click', () => {
    void refreshAllData();
});

autoRefreshInput.addEventListener('change', () => {
    setupAutoRefresh(autoRefreshInput.checked);
});

globalLogLimit.addEventListener('change', () => {
    state.logLimit = Number(globalLogLimit.value) || 50;
    void refreshAllData();
});

statusFilterSelect.addEventListener('change', () => {
    state.statusFilter = statusFilterSelect.value;
    renderSelectedService();
});

textFilterInput.addEventListener('input', () => {
    state.textFilter = textFilterInput.value.trim();
    renderSelectedService();
});

serviceFilterInput.addEventListener('input', () => {
    state.serviceFilter = serviceFilterInput.value.trim();
    renderServiceList();
});

void refreshAllData();
