from flask import Flask, render_template, request, jsonify, send_from_directory
import os
import datetime
import re
import json
import cjio as cj
from cjio import cityjson
import io
import base64  
from datetime import datetime
import requests
import time
from urllib.parse import urljoin

VALIDATOR_BASE_URL = 'http://0.0.0.0:8080/'
CHECK_INTERVAL = 0.5  # seconds
currDate = datetime.now()
app = Flask(__name__)
app.url_map.strict_slashes = False

def fetch_profiles(backend_url):
    if not backend_url.endswith('/'):
        backend_url += '/'

    url = urljoin(backend_url, 'processes')

    response = requests.get(url)
    if not response.ok:
        raise Exception(f"Could not retrieve processes: {response.status_code} {response.reason}")

    data = response.json()

    if 'processes' not in data:
        raise Exception('"processes" not found in response data')

    return [p for p in data['processes'] if not p['id'].startswith('_')]

@app.route('/process-ids')
def get_process_ids():
    try:
        processes = fetch_profiles(VALIDATOR_BASE_URL + "#validator")
        ids = [p['id'] for p in processes]
        return jsonify(ids)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/visualize', methods=['POST'])
def visualize():
    uploaded_file = request.files.get('file')
    if not uploaded_file:
        return jsonify({'error': 'No file provided'}), 400
    
    print("Received method:", request.method)

    try:
        # Save the uploaded file temporarily
        temp_file_path = os.path.join('received', 'temp_cityjson_{}.json'.format(currDate.timestamp()))
        uploaded_file.save(temp_file_path)
        print("File saved temporarily")   

        # Parse the CityJSON file
        with open(temp_file_path, "r", encoding="utf-8-sig") as f:
            cm = cityjson.reader(file=f)
        print("CityJSON parsed successfully")   

        # Export to GLB
        glb_data = cm.export2glb()
        print("GLB export successful")   

        # Generate a unique filename
        fileNameGLB = f"{request.remote_addr}_{currDate.timestamp()}.glb"
        direcGLB = os.path.join('received', fileNameGLB)

        # Write the GLB data to a file
        with open(direcGLB, "wb") as glb_file:
            glb_file.write(glb_data.getvalue())
        print("GLB file written successfully")   

        return jsonify({
            'response' : fileNameGLB
        })

    except UnicodeDecodeError as e:
        print(f"UnicodeDecodeError: {str(e)}")   
        return jsonify({'error': 'Invalid file encoding. Please upload a valid CityJSON file.'}), 400
    except Exception as e:
        print(f"Error processing GLB export: {str(e)}")   
        return jsonify({'error': f'Failed to process the file: {str(e)}'}), 500
    
@app.route('/download/<filename>', methods=['GET'])
def download(filename):
    # Serve files from the 'received' directory
    return send_from_directory('received', filename, as_attachment=False)

@app.route('/proxy/validate', methods=['POST'], strict_slashes=False)
def proxy_validate():
    try:
        request_data = request.get_json()
        cityjson = request_data.get("cityjson")
        profile_contents = request_data.get("profileContents", None)
        profile_id = request_data.get("profileId", "_shaclValidation")

        if not cityjson:
            return jsonify({"error": "Missing 'cityjson' in request"}), 400

        payload = {
            "inputs": {
                "cityFiles": [
                    {
                        "name": "file-0",
                        "data_str": cityjson
                    }
                ]
            }
        }
        if profile_contents:
            payload["inputs"]["shacl"] = profile_contents

        # Submit job
        execution_url = f"{VALIDATOR_BASE_URL}/processes/{profile_id}/execution"
        headers = {'Accept': 'application/json', 'Content-Type': 'application/json'}

        response = requests.post(execution_url, headers=headers, json=payload)
        if not response.ok:
            return jsonify({"error": f"Execution failed: {response.status_code}"}), response.status_code

        job_data = response.json()
        job_id = job_data.get("jobID")

        # Poll job status
        status_url = f"{VALIDATOR_BASE_URL}/jobs/{job_id}"
        while True:
            status_response = requests.get(status_url, headers=headers)
            if not status_response.ok:
                return jsonify({"error": "Failed to check job status"}), 500

            status = status_response.json().get("status")
            if status in ["successful"]:
                break
            elif status in ["failed", "dismissed"]:
                return jsonify({"error": f"Job failed with status: {status}"}), 500
            time.sleep(CHECK_INTERVAL)

        # Get results
        results_url = f"{VALIDATOR_BASE_URL}/jobs/{job_id}/results"
        results_response = requests.get(results_url, headers=headers)
        if not results_response.ok:
            return jsonify({"error": "Failed to fetch results"}), 500

        return results_response.json()

    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True)
