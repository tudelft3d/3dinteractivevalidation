# 1. Start with a lightweight version of Python
FROM python:3.10

# 2. Set the working directory inside the container to /app
WORKDIR /app

# 3. Copy only the requirements file first (this makes future builds faster)
COPY requirements.txt .

# 4. Install the Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# 5. Copy the rest of your app's code into the container
COPY . .

# 6. Expose port 5000 (the default port for Flask)
EXPOSE 5001

# 7. Tell Flask how to run inside a container
ENV FLASK_APP=app.py
ENV FLASK_ENV=production

# 8. Start the Flask application, allowing external connections
CMD ["flask", "run", "--host=0.0.0.0", "--port=5001"]