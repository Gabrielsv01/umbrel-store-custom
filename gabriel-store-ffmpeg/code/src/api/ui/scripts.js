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
        const filesActions = document.getElementById('filesActions');
        const clearInputBtn = document.getElementById('clearInputBtn');
        const clearOutputBtn = document.getElementById('clearOutputBtn');

        // Mostrar/esconder botões baseado no tipo selecionado e se há arquivos
        if (result.files && result.files.length > 0) {
            filesActions.style.display = 'block';
            clearInputBtn.style.display = type === 'input' ? 'inline-block' : 'none';
            clearOutputBtn.style.display = type === 'output' ? 'inline-block' : 'none';
        } else {
            filesActions.style.display = 'none';
        }

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
                    <button class="btn btn-small" onclick="openMediaModal('${file.name}')">
                        👁️ Visualizar
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
        document.getElementById('filesActions').style.display = 'none';
    }
}

async function downloadFile(type, filename) {
    window.open(`/files/${type}/${filename}`, '_blank');
}

async function downloadJobFile(filename) {
    try {
        showToast(`📥 Iniciando download de ${filename}...`);
        
        // Se o filename contém caracteres especiais, buscar o arquivo real
        if (filename.includes('$(') || filename.includes('`')) {
            // Buscar na lista de arquivos output
            const response = await fetch('/files/output');
            const result = await response.json();
            
            // Procurar arquivo que comece com o nome base (sem os caracteres especiais)
            const baseName = filename.split('$(')[0];
            const realFile = result.files?.find(file => file.name.startsWith(baseName));
            
            if (realFile) {
                filename = realFile.name;
            }
        }
        
        window.open(`/files/output/${filename}`, '_blank');
    } catch (error) {
        showToast(`❌ Erro ao baixar: ${error.message}`, 'error');
    }
}

async function viewJobFile(filename) {
    try {
        // Se o filename contém caracteres especiais, buscar o arquivo real
        if (filename.includes('$(') || filename.includes('`')) {
            // Buscar na lista de arquivos output
            const response = await fetch('/files/output');
            const result = await response.json();
            
            // Procurar arquivo que comece com o nome base (sem os caracteres especiais)
            const baseName = filename.split('$(')[0];
            const realFile = result.files?.find(file => file.name.startsWith(baseName));
            
            if (realFile) {
                filename = realFile.name;
            }
        }
        
        // Abrir modal de visualização de mídia
        openMediaModal(filename);
    } catch (error) {
        showToast(`❌ Erro ao visualizar: ${error.message}`, 'error');
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
            displayEmptyJobSections();
            return;
        }

        const jobs = result.jobs || [];
        console.log('Jobs array:', jobs, 'Length:', jobs.length);
        updateStats(jobs);

        // Ordenar jobs do mais recente para o mais antigo
        const sortedJobs = jobs.sort((a, b) => {
            const dateA = new Date(a.startTime || a.createdAt || 0);
            const dateB = new Date(b.startTime || b.createdAt || 0);
            return dateB - dateA; // Ordem decrescente (mais recente primeiro)
        });


    // Separar jobs por status (mantendo a ordenação)
    const runningJobs = sortedJobs.filter(job => job.status === 'running');
    const queuedJobs = sortedJobs.filter(job => job.status === 'queued');
    const completedJobs = sortedJobs.filter(job => job.status === 'completed');
    const failedJobs = sortedJobs.filter(job => job.status === 'failed');

    // Renderizar cada seção
    renderJobSection('runningJobsList', runningJobs, 'Nenhum job em execução');
    renderJobSection('queuedJobsList', queuedJobs, 'Nenhum job em fila');
    renderJobSection('completedJobsList', completedJobs, 'Nenhum job concluído');
    renderJobSection('failedJobsList', failedJobs, 'Nenhum job falhado');

    } catch (error) {
        console.error('Erro ao carregar jobs:', error);
        displayEmptyJobSections('Erro ao carregar jobs');
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

function formatDuration(ms) {
    if (!ms || ms === 0) return 'N/A';
    
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else if (seconds > 0) {
        return `${seconds}s`;
    } else {
        return `${ms}ms`;
    }
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

async function clearJobsByStatus(status) {
    const statusText = {
        running: 'em execução',
        completed: 'concluídos',
        failed: 'falhados'
    }[status] || status;
    
    if (!confirm(`Tem certeza que deseja remover todos os jobs ${statusText}?`)) return;
    
    try {
        // Buscar todos os jobs
        const response = await fetch('/jobs');
        const result = await response.json();
        
        if (!result.jobs) {
            showToast('❌ Erro ao carregar jobs', 'error');
            return;
        }
        
        // Filtrar jobs pelo status
        const jobsToDelete = result.jobs.filter(job => job.status === status);
        
        if (jobsToDelete.length === 0) {
            showToast(`Nenhum job ${statusText} para remover`, 'info');
            return;
        }
        
        showToast(`🗑️ Removendo ${jobsToDelete.length} jobs ${statusText}...`);
        
        // Remover cada job individualmente
        const deletePromises = jobsToDelete.map(job => 
            fetch(`/job/${job.id}`, { method: 'DELETE' })
        );
        
        const deleteResults = await Promise.all(deletePromises);
        const successCount = deleteResults.filter(res => res.ok).length;
        const failCount = deleteResults.length - successCount;
        
        if (successCount === deleteResults.length) {
            showToast(`✅ ${successCount} jobs ${statusText} removidos com sucesso!`);
        } else {
            showToast(`⚠️ ${successCount} removidos, ${failCount} falharam`, 'error');
        }
        
        // Atualizar a interface
        loadJobs();
        
    } catch (error) {
        showToast(`❌ Erro: ${error.message}`, 'error');
    }
}

async function clearAllFiles(type) {
    const typeText = type === 'input' ? 'entrada' : 'saída';
    
    if (!confirm(`Tem certeza que deseja remover TODOS os arquivos da ${typeText}?`)) return;
    
    try {
        // Buscar todos os arquivos do tipo
        const response = await fetch(`/files/${type}`);
        const result = await response.json();
        
        if (!result.files || result.files.length === 0) {
            showToast(`Nenhum arquivo na ${typeText} para remover`, 'info');
            return;
        }
        
        showToast(`🗑️ Removendo ${result.files.length} arquivos da ${typeText}...`);
        
        // Usar o endpoint de limpeza completa do diretório com confirmação
        const clearUrl = `/clear/${type}?confirm=true`;
        console.log('Clearing files with URL:', clearUrl);
        
        const clearResponse = await fetch(clearUrl, {
            method: 'DELETE'
        });
        
        const clearResult = await clearResponse.json();
        
        if (clearResult.success) {
            showToast(`✅ Todos os arquivos da ${typeText} foram removidos!`);
            // Recarregar a lista de arquivos
            loadFiles(type);
        } else {
            showToast(`❌ Erro ao limpar arquivos: ${clearResult.error}`, 'error');
        }
        
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

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (pollInterval) {
        clearInterval(pollInterval);
    }
});
// Funções auxiliares para organizar jobs por seção
function renderJobSection(containerId, jobs, emptyMessage) {
    const container = document.getElementById(containerId);
    
    if (!container) {
        console.error(`Container ${containerId} não encontrado`);
        return;
    }
    
    // Atualizar visibilidade do botão "Remover Todos" (apenas para completed e failed)
    const statusMap = {
        'completedJobsList': { btnId: 'clearCompletedBtn', status: 'completed' },
        'failedJobsList': { btnId: 'clearFailedBtn', status: 'failed' }
    };
    
    const sectionInfo = statusMap[containerId];
    if (sectionInfo) {
        const clearBtn = document.getElementById(sectionInfo.btnId);
        if (clearBtn) {
            clearBtn.style.display = jobs.length > 0 ? 'inline-block' : 'none';
        }
    }
    
    if (jobs.length === 0) {
        container.innerHTML = `<div class="no-data">${emptyMessage}</div>`;
        return;
    }
    
    container.innerHTML = jobs.map(job => renderJobItem(job)).join('');
}

function renderJobItem(job) {
    const duration = formatDuration(job.duration);
    
    // Extrair nome do arquivo de saída do comando
    let outputFileName = null;
    
    // Primeiro, tentar extrair do stderr (saída do FFmpeg)
    if (job.stderr) {
        const stderrMatch = job.stderr.match(/Output #0, [^,]+, to '\/shared\/output\/([^']+)'/);
        if (stderrMatch) {
            outputFileName = stderrMatch[1];
        }
    }
    
    // Se não encontrou no stderr, tentar no comando original
    if (!outputFileName) {
        const outputMatch = job.command.match(/\/shared\/output\/([^\s"']+)/);
        outputFileName = outputMatch ? outputMatch[1] : job.outputFile;
    }
    
    // Se ainda contém caracteres especiais como $(, usar o outputFile do job
    if (outputFileName && (outputFileName.includes('$(') || outputFileName.includes('`'))) {
        outputFileName = job.outputFile;
    }
    
    return `
    <div class="job-item ${job.status}">
        <div class="job-header">
            <div class="job-title-container">
                <div class="job-title-label">Job ID:</div>
                <div class="job-title-wrapper">
                    <div class="job-title">${job.id}</div>
                </div>
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
            <button class="btn btn-small" onclick="openJobModal('${job.id}')">
                📋 Detalhes
            </button>
            <button class="btn btn-small btn-danger" onclick="deleteJob('${job.id}')">
                🗑️ Remover Job
            </button>
            ${job.status === 'completed' && outputFileName ? `
            <button class="btn btn-small btn-secondary" onclick="downloadJobFile('${outputFileName}')">
                📥 Baixar Arquivo
            </button>
            <button class="btn btn-small" onclick="viewJobFile('${outputFileName}')">
                👁️ Visualizar
            </button>
            ` : ''}
        </div>
        </div>
    </div>
    `;
}

function displayEmptyJobSections(errorMessage = '') {
    const sections = [
        { id: 'runningJobsList', message: errorMessage || 'Nenhum job em execução' },
        { id: 'completedJobsList', message: errorMessage || 'Nenhum job concluído' },
        { id: 'failedJobsList', message: errorMessage || 'Nenhum job falhado' }
    ];
    
    sections.forEach(section => {
        const container = document.getElementById(section.id);
        if (container) {
            container.innerHTML = `<div class="no-data">${section.message}</div>`;
        }
    });
}

// FFmpeg Command Functions
async function executeFFmpegCommand() {
    const commandInput = document.getElementById('ffmpegCommand');
    const command = commandInput.value.trim();
    
    if (!command) {
        showToast('Por favor, insira um comando FFmpeg', 'error');
        return;
    }
    
    // Validação básica se é comando FFmpeg
    if (!command.toLowerCase().startsWith('ffmpeg')) {
        showToast('O comando deve começar com "ffmpeg"', 'error');
        return;
    }
    
    try {
        showToast('Executando comando FFmpeg...', 'info');
        
        const response = await fetch('/ffmpeg-async', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ command })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast(`Comando executado! Job ID: ${result.jobId}`, 'success');
            commandInput.value = '';
            
            // Atualizar jobs automaticamente
            setTimeout(() => {
                loadJobs();
            }, 1000);
        } else {
            showToast(`Erro: ${result.message}`, 'error');
        }
    } catch (error) {
        console.error('Erro ao executar comando:', error);
        showToast('Erro ao executar comando FFmpeg', 'error');
    }
}

function clearCommand() {
    document.getElementById('ffmpegCommand').value = '';
    showToast('Comando limpo', 'info');
}

function setExampleCommand(type) {
    const examples = {
        compress: 'ffmpeg -i /shared/input/video.mp4 -c:v libx264 -crf 23 -preset medium /shared/output/compressed.mp4',
        convert: 'ffmpeg -i /shared/input/video.mp4 -c:v libx264 -c:a aac /shared/output/converted.mp4',
        audio: 'ffmpeg -i /shared/input/video.mp4 -vn -c:a mp3 /shared/output/audio.mp3',
        resize: 'ffmpeg -i /shared/input/video.mp4 -vf scale=1280:720 -c:v libx264 /shared/output/resized.mp4'
    };
    
    const commandInput = document.getElementById('ffmpegCommand');
    commandInput.value = examples[type] || '';
    commandInput.focus();
    
    showToast(`Exemplo carregado: ${type}`, 'info');
}

// Job Modal Functions
async function openJobModal(jobId) {
    const modal = document.getElementById('jobModal');
    const modalBody = document.getElementById('jobModalBody');
    
    // Mostrar modal com loading
    modal.style.display = 'block';
    modalBody.innerHTML = '<div class="loading">Carregando informações do job...</div>';
    
    try {
        // Buscar detalhes do job
        const response = await fetch(`/job/${jobId}`);
        if (!response.ok) {
            throw new Error('Job não encontrado');
        }
        
        const job = await response.json();
        
        // Renderizar informações do job
        modalBody.innerHTML = renderJobDetails(job);
        
    } catch (error) {
        console.error('Erro ao carregar job:', error);
        modalBody.innerHTML = `
            <div class="job-detail-section">
                <h4>❌ Erro</h4>
                <p>Não foi possível carregar as informações do job: ${error.message}</p>
            </div>
        `;
    }
}

function closeJobModal() {
    const modal = document.getElementById('jobModal');
    modal.style.display = 'none';
}

function renderJobDetails(job) {
    const startTime = job.startTime || job.createdAt;
    const duration = job.duration ? formatDuration(job.duration) : 'N/A';
    
    // Extrair nome do arquivo de output se existir
    let outputFileName = 'N/A';
    if (job.command) {
        const match = job.command.match(/\/shared\/output\/([^\s]+)/);
        if (match) {
            outputFileName = match[1];
        }
    }
    
    return `
        <div class="job-detail-section">
            <h4>🆔 Identificação</h4>
            <div class="job-detail-item">
                <span class="job-detail-label">Job ID:</span>
                <span class="job-detail-value">${job.id}</span>
            </div>
            <div class="job-detail-item">
                <span class="job-detail-label">Status:</span>
                <span class="job-detail-value">
                    <span class="job-status-badge status-${job.status}">
                        ${getStatusText(job.status)}
                    </span>
                </span>
            </div>
        </div>

        <div class="job-detail-section">
            <h4>⏱️ Tempo de Execução</h4>
            <div class="job-detail-item">
                <span class="job-detail-label">Iniciado em:</span>
                <span class="job-detail-value">${new Date(startTime).toLocaleString('pt-BR')}</span>
            </div>
            ${job.endTime ? `
            <div class="job-detail-item">
                <span class="job-detail-label">Concluído em:</span>
                <span class="job-detail-value">${new Date(job.endTime).toLocaleString('pt-BR')}</span>
            </div>
            ` : ''}
            <div class="job-detail-item">
                <span class="job-detail-label">Duração:</span>
                <span class="job-detail-value">${duration}</span>
            </div>
        </div>

        <div class="job-detail-section">
            <h4>📁 Arquivos</h4>
            <div class="job-detail-item">
                <span class="job-detail-label">Arquivo de Saída:</span>
                <span class="job-detail-value">${outputFileName}</span>
            </div>
            ${job.status === 'completed' && outputFileName !== 'N/A' ? `
            <div class="job-detail-item">
                <span class="job-detail-label">Ações:</span>
                <span class="job-detail-value">
                    <button class="btn btn-small btn-secondary" onclick="downloadJobFile('${outputFileName}'); closeJobModal();">
                        📥 Baixar
                    </button>
                </span>
            </div>
            ` : ''}
        </div>

        <div class="job-detail-section">
            <h4>💻 Comando Executado</h4>
            <div class="job-command">${job.command || 'N/A'}</div>
        </div>

        ${job.output ? `
        <div class="job-detail-section">
            <h4>📋 Log de Execução</h4>
            <div class="job-command">${job.output}</div>
        </div>
        ` : ''}

        ${job.status === 'failed' && job.error ? `
        <div class="job-detail-section">
            <h4 style="color: #e53e3e;">❌ Erro</h4>
            <div class="job-command" style="background: #fed7d7; color: #c53030;">
                ${job.error}
            </div>
        </div>
        ` : ''}
    `;
}

// Fechar modal clicando fora dele
window.onclick = function(event) {
    const jobModal = document.getElementById('jobModal');
    const mediaModal = document.getElementById('mediaModal');
    
    if (event.target === jobModal) {
        closeJobModal();
    }
    
    if (event.target === mediaModal) {
        closeMediaModal();
    }
}

// Media Modal Functions
async function openMediaModal(filename) {
    const modal = document.getElementById('mediaModal');
    const modalTitle = document.getElementById('mediaModalTitle');
    const modalBody = document.getElementById('mediaModalBody');
    
    // Mostrar modal com loading
    modal.style.display = 'block';
    modalTitle.textContent = `🎬 ${filename}`;
    modalBody.innerHTML = '<div class="loading">Carregando arquivo...</div>';
    
    try {
        // Buscar informações do arquivo
        const response = await fetch('/files/output');
        const result = await response.json();
        const fileInfo = result.files?.find(file => file.name === filename);
        
        // Detectar tipo de arquivo
        const fileExtension = filename.toLowerCase().split('.').pop();
        const isVideo = ['mp4', 'webm', 'ogg', 'avi', 'mov', 'mkv'].includes(fileExtension);
        const isAudio = ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac'].includes(fileExtension);
        const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(fileExtension);
        
        const fileUrl = `/files/output/${filename}`;
        
        // Criar informações do arquivo
        const fileInfoHtml = fileInfo ? `
            <div class="media-info">
                <h4>📋 Informações do Arquivo</h4>
                <div class="file-info-grid">
                    <div class="info-item">
                        <span class="info-label">Nome:</span>
                        <span class="info-value">${filename}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Tamanho:</span>
                        <span class="info-value">${fileInfo.sizeFormatted || fileInfo.size}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Tipo:</span>
                        <span class="info-value">${fileExtension.toUpperCase()}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Modificado:</span>
                        <span class="info-value">${fileInfo.modified || 'Data não disponível'}</span>
                    </div>
                </div>
            </div>
        ` : `
            <div class="media-info">
                <h4>📋 Informações do Arquivo</h4>
                <p><strong>Nome:</strong> ${filename}</p>
                <p><strong>Tipo:</strong> ${fileExtension.toUpperCase()}</p>
            </div>
        `;
        
        if (isVideo) {
            modalBody.innerHTML = `
                <div class="media-player">
                    <video controls preload="metadata">
                        <source src="${fileUrl}" type="video/${fileExtension === 'mp4' ? 'mp4' : fileExtension}">
                        Seu navegador não suporta este formato de vídeo.
                    </video>
                </div>
                ${fileInfoHtml}
                <div class="media-controls">
                    <button class="btn btn-small btn-secondary" onclick="downloadJobFile('${filename}')">
                        � Baixar Arquivo
                    </button>
                </div>
            `;
        } else if (isAudio) {
            modalBody.innerHTML = `
                <div class="media-player">
                    <audio controls preload="metadata" style="width: 100%;">
                        <source src="${fileUrl}" type="audio/${fileExtension}">
                        Seu navegador não suporta este formato de áudio.
                    </audio>
                </div>
                ${fileInfoHtml}
                <div class="media-controls">
                    <button class="btn btn-small btn-secondary" onclick="downloadJobFile('${filename}')">
                        📥 Baixar Arquivo
                    </button>
                </div>
            `;
        } else if (isImage) {
            modalBody.innerHTML = `
                <div class="media-player">
                    <img src="${fileUrl}" alt="${filename}" style="max-width: 100%; height: auto; border-radius: 8px;">
                </div>
                ${fileInfoHtml}
                <div class="media-controls">
                    <button class="btn btn-small btn-secondary" onclick="downloadJobFile('${filename}')">
                        📥 Baixar Arquivo
                    </button>
                </div>
            `;
        } else {
            modalBody.innerHTML = `
                <div class="unsupported-format">
                    <h4>📄 Formato não suportado para visualização</h4>
                    <p>O arquivo <strong>${filename}</strong> não pode ser visualizado diretamente no navegador.</p>
                    <p>Você pode baixá-lo para visualizar em um aplicativo apropriado.</p>
                </div>
                ${fileInfoHtml}
                <div class="media-controls">
                    <button class="btn btn-small btn-secondary" onclick="downloadJobFile('${filename}')">
                        📥 Baixar Arquivo
                    </button>
                </div>
            `;
        }
    } catch (error) {
        console.error('Erro ao carregar informações do arquivo:', error);
        modalBody.innerHTML = `
            <div class="unsupported-format">
                <h4>❌ Erro ao carregar arquivo</h4>
                <p>Não foi possível carregar as informações do arquivo: ${error.message}</p>
            </div>
        `;
    }
}

function closeMediaModal() {
    const modal = document.getElementById('mediaModal');
    const modalBody = document.getElementById('mediaModalBody');
    
    // Parar qualquer mídia em reprodução
    const videos = modalBody.querySelectorAll('video');
    const audios = modalBody.querySelectorAll('audio');
    
    videos.forEach(video => {
        video.pause();
        video.currentTime = 0;
    });
    
    audios.forEach(audio => {
        audio.pause();
        audio.currentTime = 0;
    });
    
    modal.style.display = 'none';
}
