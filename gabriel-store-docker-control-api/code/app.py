import subprocess
from flask import Flask, jsonify, abort

app = Flask(__name__)

def executar_comando_docker(comando, nome_container):
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

@app.route('/containers/<string:nome_container>/stop', methods=['POST'])
def parar_container(nome_container):
    """Para um container com o nome especificado."""
    return executar_comando_docker("stop", nome_container)

@app.route('/containers/<string:nome_container>/start', methods=['POST'])
def iniciar_container(nome_container):
    """Inicia um container com o nome especificado."""
    return executar_comando_docker("start", nome_container)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5123)