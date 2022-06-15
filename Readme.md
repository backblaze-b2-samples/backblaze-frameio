# S3 Archiver
Install Poetry 
``https://github.com/python-poetry/poetry``

use this command on Mac

```curl -sSL https://install.python-poetry.org | python3 - ```

use ```pyenv``` to manage python versions - make sure you have 3.9.5 installed 

set the local python version for your project
```pyenv local 3.9.5```

pip3 install poetry

then have poetry use the right python version 

```poetry env use $(pyenv which python)```

poetry install
poetry shell

Sign up for ngrok.com account 

```link to sign up```

download ```ngrok``` binary and then run command to add auth token.

Need to set env variables for all the variables in ```config.py```

## Questions
E-mail bstaszcuk@backblaze.com or elton@backblaze.com