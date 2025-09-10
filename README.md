# CHEK Validation Results Viewer

This is a lightweight Flask-based web application for uploading, validating, and visualizing [CityJSON](https://www.cityjson.org/) files. It leverages the [CHEK Validator](https://defs-dev.opengis.net/chek-validator) to validate CityJSON data against SHACL profiles and converts the data to a GLB format for 3D visualization.

## 🚀 Features

- Upload a CityJSON file and convert it to a 3D GLB model.
- Validate CityJSON against standard or custom SHACL profiles via CHEK.
- Download the resulting GLB model for visualization.
- Proxy-based validation to handle CORS and simplify client-side logic.

## 🛠️ Tech Stack

- Python 3
- Flask
- [cjio](https://github.com/cityjson/cjio) for CityJSON parsing and GLB export
- HTML (frontend in `templates/index.html`)
- [CHEK Validator API](https://defs-dev.opengis.net/chek-validator)

## 📦 Installation

### Clone & Install Dependencies

##### Clone the repo
```bash
git clone https://github.com/tudelft3d/3dinteractivevalidation.git
cd 3dinteractivevalidation
```

##### Create a virtual env with all the dependencies
```bash
python3 -m .venv venv
source .venv/bin/activate
pip install -r requirements.txt
```

##### Run the application
```bash
python3 app.py
```
