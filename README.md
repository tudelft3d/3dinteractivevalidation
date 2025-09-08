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

### Prerequisites

- Anaconda 3

### Clone & Install Dependencies

```bash
git clone https://github.com/alpertungakin/chek-validation_info_view.git
cd chek-validation_info_view
conda env create -f environment.yml
```

### Run the application

```bash
conda activate chek
python app.py
```
