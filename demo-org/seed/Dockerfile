FROM python:3.12-slim
RUN pip install --no-cache-dir requests==2.32.5 faker==37.12.0 "psycopg[binary]==3.2.12" ldap3==2.9.1 pyyaml==6.0.3
WORKDIR /seed
COPY *.py ./
CMD ["python", "-u", "main.py"]
