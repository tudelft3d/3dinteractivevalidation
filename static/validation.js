function checkValidate(backendUrl, {
  file,
  contents,
  profileContents,
  profileId,
  checkTimeoutMS: checkResultsTimeoutMS = 500
}) {

  if (!backendUrl.endsWith('/')) {
    backendUrl += '/';
  }
  let promiseResolve = null;
  let promiseReject = null;
  const result = new Promise((resolve, reject) => {
    promiseResolve = resolve;
    promiseReject = reject;
  });
  let currentTimeout;

  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };

  let jobId = null;
  let jobStatus = null;

  const execute = async () => {
    try {
      const requestData = {
        inputs: {
          cityFiles: [
            {
              name: "file-0",
              data_str: contents || await file.text(),
            },
          ],
        },
      };
      let actualProfileId = profileId;
      if (!profileId) {
        actualProfileId = '_shaclValidation';
        requestData.inputs.shacl = profileContents;
      }
      let response = await fetch(new URL(`processes/${actualProfileId}/execution`, backendUrl), {
        method: 'POST',
        headers,
        body: JSON.stringify(requestData),
      });
      if (!response.ok) {
        promiseReject(`Request failed with status ${response.status} - ${response.statusText}`);
      }
      let data = await response.json();

      jobId = data.jobID;
      jobStatus = data.status;
      if (['accepted', 'running'].includes(data.status)) {
        currentTimeout = setTimeout(checkJobStatus, checkResultsTimeoutMS);
      } else if (data.status === 'successful') {
        fetchResults();
      } else {
        promiseReject(`Job submission failed with status ${data.status}`);
      }
    } catch (e) {
      promiseReject(e);
    }
  };

  const checkJobStatus = async () => {
    try {
      let response = await fetch(new URL(`jobs/${jobId}`, backendUrl), {
        headers,
      });
      if (!response.ok) {
        promiseReject(`Request failed with status ${response.status} - ${response.statusText}`);
      }
      let data = await response.json();
      jobStatus = data.status;
      if (['accepted', 'running'].includes(data.status)) {
        setTimeout(checkJobStatus, checkResultsTimeoutMS);
      } else {
        fetchResults();
      }
    } catch (e) {
      promiseReject(e);
    }
  };

  const fetchResults = async () => {
    try {
      let response = await fetch(new URL(`jobs/${jobId}/results`, backendUrl), {
        headers,
      });
      if (!response.ok) {
        promiseReject(`Error retrieving job results: ${response.status} - ${response.statusText}`);
      }
      try {
        promiseResolve(await response.json());
      } catch (e) {
        promiseReject(await response.text());
      }
    } catch (e) {
      promiseReject(e);
    }
  };

  const cancel = () => {
    clearTimeout(currentTimeout);
  }

  execute();

  return {
    cancel,
    result,
  };
}

async function fetchProfiles(backendUrl) {
  if (!backendUrl.endsWith('/')) {
    backendUrl += '/';
  }
  const response = await fetch(new URL(`processes`, backendUrl));
  if (!response.ok) {
    throw new Error(`Could not retrieve processes: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  if (!data.processes) {
    throw new Error('"processes" not found in response data');
  }
  return data.processes.filter(p => !p.id.startsWith('_'));
}