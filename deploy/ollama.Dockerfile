# Private Ollama service for Render (or any Docker host / DigitalOcean GPU Droplet).
FROM ollama/ollama:latest
ENV OLLAMA_HOST=0.0.0.0:11434
COPY deploy/ollama-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/bin/bash", "/entrypoint.sh"]
