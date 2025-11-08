// Global variables
let selectedFiles = [];
let pollInterval = null;

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    setupEventListeners();
    refreshData();
    loadFiles('output');
    startAutoRefresh();
});

function setupEventListeners() {
    // Event listeners removed - no upload or presets functionality
}

async function loadFiles(type) {
    try {
        document.getElementById('inputBtn').classList.toggle('btn-secondary', type !== 'input');
        document.getElementById('outputBtn').classList.toggle('btn-secondary', type === 'input');

        const response = await fetch(`/files/${type}`);
        const result = await response.json();

        const filesList = document.getElementById('filesList');

        if (!result.files || result.files.length === 0) {
            filesList.innerHTML = '<div class="no-data">Nenhum arquivo encontrado</div>';
            return;
        }

        filesList.innerHTML = result.files.map(file => `
            <div class="file-item">
                <div class="file-info">
                    <div class="file-name">${file.name}</div>
                    <div class="file-meta">${file.sizeFormatted || file.size} • ${file.modified || 'Data não disponível'}</div>
                </div>
                <div class="file-actions">
                    <button class="btn btn-small btn-secondary" onclick="downloadFile('${type}', '${file.name}')">
                        📥 Download
                    </button>
                    <button class="btn btn-small btn-danger" onclick="deleteFile('${type}', '${file.name}')">
                        🗑️ Deletar
                    </button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Erro ao carregar arquivos:', error);
        document.getElementById('filesList').innerHTML = '<div class="no-data">Erro ao carregar arquivos</div>';
    }
}

async function downloadFile(type, filename) {
    window.open(`/download/${filename}`, '_blank');
}

async function downloadJobFile(filename) {
    try {
        showToast(`📥 Iniciando download de ${filename}...`);
        window.open(`/download/${filename}`, '_blank');
    } catch (error) {
        showToast(`❌ Erro ao baixar: ${error.message}`, 'error');
    }
}

async function viewJobFile(filename) {
    try {
        // Abre o arquivo em uma nova aba para visualização
        window.open(`/files/${filename}`, '_blank');
    } catch (error) {
        showToast(`❌ Erro ao visualizar: ${error.message}`, 'error');
    }
}

async function viewJobDetails(jobId) {
    try {
        const response = await fetch(`/job/${jobId}`);
        const result = await response.json();
        
        if (result.success) {
            showToast(`📊 Job ${jobId}: ${result.job.status}`, 'success');
        } else {
            showToast(`❌ Erro ao obter detalhes do job`, 'error');
        }
    } catch (error) {
        showToast(`❌ Erro: ${error.message}`, 'error');
    }
}

async function deleteFile(type, filename) {
    if (!confirm(`Deletar ${filename}?`)) return;

    try {
        const response = await fetch(`/files/${type}/${filename}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (result.success) {
            showToast(`✅ ${filename} deletado!`);
            loadFiles(type);
        } else {
            showToast(`❌ Erro ao deletar ${filename}`, 'error');
        }
    } catch (error) {
        showToast(`❌ Erro: ${error.message}`, 'error');
    }
}

async function loadJobs() {
    console.log('loadJobs() called');
    try {
        console.log('Fetching /jobs...');
        const response = await fetch('/jobs');
        console.log('Response received:', response.status);
        const result = await response.json();
        console.log('Jobs data:', result);

        if (!result.jobs) {
            console.log('No jobs property in result');
            document.getElementById('jobsList').innerHTML = '<div class="no-data">Erro ao carregar jobs</div>';
            return;
        }

        const jobs = result.jobs || [];
        console.log('Jobs array:', jobs, 'Length:', jobs.length);
        updateStats(jobs);

        if (jobs.length === 0) {
            document.getElementById('jobsList').innerHTML = '<div class="no-data">Nenhum job encontrado</div>';
            return;
        }

        document.getElementById('jobsList').innerHTML = jobs.map(job => {
            const duration = job.duration ? `${Math.round(job.duration)}ms` : 'N/A';
            const isLongCommand = job.command.length > 80;
            const commandShort = isLongCommand ? job.command.substring(0, 80) + '...' : job.command;
            
            // Extrair nome do arquivo de saída do comando
            const outputMatch = job.command.match(/\/shared\/output\/([^\s]+)/);
            const outputFileName = outputMatch ? outputMatch[1] : job.outputFile;
            
            return `
            <div class="job-item ${job.status}">
                <div class="job-header">
                    <div class="job-title-container">
                        <div class="job-title-label">Job ID:</div>
                        <div class="job-title">${job.id}</div>
                    </div>
                    <div class="job-status ${job.status}">${getStatusText(job.status)}</div>
                </div>
                
                <div class="job-details">
                    <div class="job-command">${job.command}</div>
                    
                    <div class="job-meta">
                        <div class="job-meta-item">
                            <div class="job-meta-label">Iniciado</div>
                            <div class="job-meta-value">${new Date(job.startTime || job.createdAt).toLocaleString()}</div>
                        </div>
                        ${job.endTime ? `
                        <div class="job-meta-item">
                            <div class="job-meta-label">Concluído</div>
                            <div class="job-meta-value">${new Date(job.endTime).toLocaleString()}</div>
                        </div>
                        ` : ''}
                        ${job.duration ? `
                        <div class="job-meta-item">
                            <div class="job-meta-label">Duração</div>
                            <div class="job-meta-value">
                                <span class="duration-badge">${duration}</span>
                            </div>
                        </div>
                        ` : ''}
                        ${outputFileName ? `
                        <div class="job-meta-item">
                            <div class="job-meta-label">Arquivo Gerado</div>
                            <div class="job-meta-value">
                                <span class="file-path">/shared/output/${outputFileName}</span>
                            </div>
                        </div>
                        ` : ''}
                    </div>
                </div>
                
                ${job.status === 'running' ? '<div class="job-progress"><div class="job-progress-fill" style="width: 50%"></div></div>' : ''}
                
                ${job.output ? `
                    <div class="job-output">
                        <strong>Log de Execução:</strong><br>
                        <pre>${job.output}</pre>
                    </div>
                ` : ''}
                
                ${job.status === 'failed' && job.output ? `
                    <div class="job-error">
                        <strong>Erro de Execução:</strong><br>
                        ${job.output}
                    </div>
                ` : ''}
                
                <div class="job-actions">
                    <button class="btn btn-small btn-danger" onclick="deleteJob('${job.id}')">
                        🗑️ Remover Job
                    </button>
                    ${job.status === 'completed' && outputFileName ? `
                    <button class="btn btn-small btn-secondary" onclick="downloadJobFile('${outputFileName}')">
                        📥 Baixar Arquivo
                    </button>
                    <button class="btn btn-small" onclick="viewJobFile('${outputFileName}')">
                        �️ Visualizar
                    </button>
                    ` : ''}
                    ${job.status === 'running' ? `
                    <button class="btn btn-small" onclick="viewJobDetails('${job.id}')">
                        📊 Detalhes
                    </button>
                    ` : ''}
                </div>
            </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Erro ao carregar jobs:', error);
        document.getElementById('jobsList').innerHTML = '<div class="no-data">Erro ao carregar jobs</div>';
    }
}

function updateStats(jobs) {
    const total = jobs.length;
    const running = jobs.filter(job => job.status === 'running').length;
    const completed = jobs.filter(job => job.status === 'completed').length;
    const failed = jobs.filter(job => job.status === 'failed').length;

    console.log('Updating stats:', { total, running, completed, failed });

    document.getElementById('totalJobs').textContent = total;
    document.getElementById('runningJobs').textContent = running;
    document.getElementById('completedJobs').textContent = completed;
    document.getElementById('failedJobs').textContent = failed;
}

function getStatusText(status) {
    const statusMap = {
        running: 'Em Execução',
        completed: 'Concluído',
        failed: 'Falhado',
        pending: 'Pendente'
    };
    return statusMap[status] || status;
}

async function deleteJob(jobId) {
    if (!confirm('Remover este job?')) return;

    try {
        const response = await fetch(`/job/${jobId}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (result.success) {
            showToast('✅ Job removido!');
            loadJobs();
        } else {
            showToast('❌ Erro ao remover job', 'error');
        }
    } catch (error) {
        showToast(`❌ Erro: ${error.message}`, 'error');
    }
}

async function clearJobs() {
    if (!confirm('Limpar todos os jobs concluídos e falhados?')) return;
    
    try {
        showToast('Funcionalidade em desenvolvimento');
    } catch (error) {
        showToast(`❌ Erro: ${error.message}`, 'error');
    }
}

function refreshData() {
    loadJobs();
}

function startAutoRefresh() {
    pollInterval = setInterval(() => {
        loadJobs();
    }, 5000); // Refresh every 5 seconds
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type === 'error' ? 'error' : ''} show`;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (pollInterval) {
        clearInterval(pollInterval);
    }
});

// Função para alternar entre comando completo e resumido
function toggleCommand(jobId) {
    const cmdElement = document.getElementById(`cmd-${jobId}`);
    const toggleElement = document.getElementById(`toggle-${jobId}`);
    
    if (!cmdElement || !toggleElement) {
        console.error('Elementos não encontrados:', jobId);
        return;
    }
    
    const fullCommand = cmdElement.getAttribute('data-full');
    const shortCommand = cmdElement.getAttribute('data-short');
    
    if (!fullCommand || !shortCommand) {
        console.error('Dados do comando não encontrados');
        return;
    }
    
    // Decodificar HTML entities
    const decodedFull = fullCommand.replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    const decodedShort = shortCommand.replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    
    const currentText = cmdElement.textContent.trim();
    const isExpanded = currentText === decodedFull.trim();
    
    if (isExpanded) {
        cmdElement.textContent = decodedShort;
        toggleElement.textContent = '👁️';
        cmdElement.title = 'Comando resumido - clique no ícone do olho para ver completo';
    } else {
        cmdElement.textContent = decodedFull;
        toggleElement.textContent = '�';
        cmdElement.title = 'Comando completo - clique na seta para resumir';
    }
}

// Função para copiar comando
async function copyCommand(jobId) {
    const cmdElement = document.getElementById(`cmd-${jobId}`);
    
    if (!cmdElement) {
        console.error('Elemento do comando não encontrado:', jobId);
        return;
    }
    
    const fullCommand = cmdElement.getAttribute('data-full');
    
    if (!fullCommand) {
        console.error('Comando não encontrado nos dados');
        return;
    }
    
    // Decodificar HTML entities para obter o comando original
    const decodedCommand = fullCommand.replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    
    try {
        await navigator.clipboard.writeText(decodedCommand);
        showToast('📋 Comando copiado para a área de transferência!', 'success');
    } catch (err) {
        console.error('Erro ao copiar com clipboard API:', err);
        // Fallback para navegadores mais antigos
        try {
            const textArea = document.createElement('textarea');
            textArea.value = decodedCommand;
            textArea.style.position = 'fixed';
            textArea.style.top = '0';
            textArea.style.left = '0';
            textArea.style.width = '2em';
            textArea.style.height = '2em';
            textArea.style.padding = '0';
            textArea.style.border = 'none';
            textArea.style.outline = 'none';
            textArea.style.boxShadow = 'none';
            textArea.style.background = 'transparent';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            
            if (successful) {
                showToast('📋 Comando copiado!', 'success');
            } else {
                throw new Error('Comando copy falhou');
            }
        } catch (fallbackErr) {
            console.error('Fallback copy também falhou:', fallbackErr);
            showToast('❌ Erro ao copiar comando', 'error');
        }
    }
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type === 'error' ? 'error' : ''} show`;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (pollInterval) {
        clearInterval(pollInterval);
    }
});