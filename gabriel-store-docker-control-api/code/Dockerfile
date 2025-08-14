# Usa uma imagem base leve do Python
FROM python:3.9-slim

# Define o diretório de trabalho
WORKDIR /app

# Instala o cliente Docker (o comando 'docker')
RUN apt-get update && apt-get install -y docker.io

# Copia o código da API para a imagem
COPY . /app

# Instala as dependências do Python
RUN pip install flask

# Expõe a porta que o Flask vai usar
EXPOSE 5123

# Define o comando para iniciar o servidor Flask
CMD ["python", "app.py"]