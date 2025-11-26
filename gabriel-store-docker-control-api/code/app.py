import os
import subprocess
import json
import secrets
from flask import Flask, jsonify, request, render_template, abort, redirect, url_for, session
from functools import wraps


app = Flask(__name__)
app.secret_key = secrets.token_hex(16) 


AUTH_FILE = 'authorized_containers.json'
API_TOKEN = secrets.token_hex(16)
USERNAME = os.environ.get("USERNAME", "admin")
PASSWORD = os.environ.get("PASSWORD", "senha123")
AUTHORIZED_CONTAINERS_ENV = os.environ.get("AUTHORIZED_CONTAINERS", "")


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("logged_in"):
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated

def require_token(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get("X-API-Token")
        if not token or token != API_TOKEN:
            abort(401, description="Token inválido ou ausente")
        return f(*args, **kwargs)
    return decorated

def load_authorized_containers():
    # Se o arquivo não existe e a env está definida, inicializa e salva
    if not os.path.exists(AUTH_FILE) and AUTHORIZED_CONTAINERS_ENV:
        containers = [c.strip() for c in AUTHORIZED_CONTAINERS_ENV.split(",") if c.strip()]
        save_authorized_containers(containers)
        return containers
    try:
        with open(AUTH_FILE, 'r') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []

def save_authorized_containers(containers):
    with open(AUTH_FILE, 'w') as f:
        json.dump(containers, f, indent=4)

def executar_comando_docker(comando, nome_container):
    authorized = load_authorized_containers()
    if nome_container not in authorized:
        return jsonify({
            "status": "erro",
            "mensagem": f"Container '{nome_container}' não está na lista de autorizados."
        }), 403
        
    try:
        comando_completo = ["docker", comando, nome_container]
        resultado = subprocess.run(
            comando_completo,
            check=True,
            capture_output=True,
            text=True
        )
        return jsonify({
            "status": "sucesso",
            "comando_executado": " ".join(comando_completo),
            "saida": resultado.stdout
        }), 200
    except subprocess.CalledProcessError as e:
        return jsonify({
            "status": "erro",
            "comando_executado": " ".join(e.cmd),
            "mensagem": e.stderr,
            "codigo_de_saida": e.returncode
        }), 500


@app.route('/login', methods=['GET', 'POST'])
def login():
    error = None
    if request.method == "POST":
        if request.form.get("username") == USERNAME and request.form.get("password") == PASSWORD:
            session["logged_in"] = True
            return redirect(url_for("index"))
        else:
            error = "Usuário ou senha inválidos."
    return render_template("login.html", error=error)

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for("login"))

@app.route('/')
@login_required
def index():
    return render_template('index.html', api_token=API_TOKEN)


@app.route('/api/authorized-containers', methods=['GET'])
@require_token
def get_authorized_containers():
    return jsonify(load_authorized_containers())

@app.route('/api/token', methods=['POST'])
def get_api_token():
    data = request.json
    username = data.get('username')
    password = data.get('password')
    if username == USERNAME and password == PASSWORD:
        return jsonify({"api_token": API_TOKEN}), 200
    return jsonify({"erro": "Usuário ou senha inválidos"}), 401

@app.route('/api/authorized-containers', methods=['POST'])
@require_token
def add_authorized_container():
    data = request.json
    nome_container = data.get('container_name')
    if not nome_container:
        return jsonify({"erro": "Nome do container é obrigatório"}), 400
    containers = load_authorized_containers()
    if nome_container not in containers:
        containers.append(nome_container)
        save_authorized_containers(containers)
    return jsonify({"status": "sucesso", "containers": containers})


@app.route('/api/authorized-containers/<string:nome_container>', methods=['DELETE'])
@require_token
def remove_authorized_container(nome_container):
    containers = load_authorized_containers()
    if nome_container in containers:
        containers.remove(nome_container)
        save_authorized_containers(containers)
    return jsonify({"status": "sucesso", "containers": containers})


@app.route('/api/containers/<string:nome_container>/stop', methods=['POST'])
@require_token
def parar_container(nome_container):
    return executar_comando_docker("stop", nome_container)

@app.route('/api/containers/<string:nome_container>/start', methods=['POST'])
@require_token
def iniciar_container(nome_container):
    return executar_comando_docker("start", nome_container)

if __name__ == '__main__':
    if AUTHORIZED_CONTAINERS_ENV and not os.path.exists(AUTH_FILE):
        containers = [c.strip() for c in AUTHORIZED_CONTAINERS_ENV.split(",") if c.strip()]
        save_authorized_containers(containers)
    app.run(host='0.0.0.0', port=5123)