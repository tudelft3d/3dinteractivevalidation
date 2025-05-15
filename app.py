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

currDate = datetime.now()
app = Flask(__name__)

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

if __name__ == '__main__':
    app.run(debug=True)
