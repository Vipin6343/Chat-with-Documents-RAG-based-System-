from conftest import workspace


def test_swagger_upload_schema_and_multiple_files(setup):
    client, _, _, _ = setup
    schema = client.get('/openapi.json').json()
    operation = schema['paths']['/api/workspaces/{workspace_id}/documents']['post']
    body = operation['requestBody']['content']['multipart/form-data']['schema']
    component = schema['components']['schemas'][body['$ref'].rsplit('/', 1)[1]]
    files = component['properties']['files']
    assert 'files' in component['required']
    assert files['type'] == 'array'
    assert files['items']['type'] == 'string'
    assert files['items']['format'] == 'binary'

    wid = workspace(client)
    response = client.post(f'/api/workspaces/{wid}/documents', files=[
        ('files', ('first.txt', b'apple red', 'text/plain')),
        ('files', ('second.txt', b'banana yellow', 'text/plain')),
    ])
    assert response.status_code == 202
    assert len(response.json()) == 2
    assert all(item['document'] and not item['error'] for item in response.json())
    documents = client.get(f'/api/workspaces/{wid}/documents').json()
    assert len(documents) == 2
    assert all(document['status'] == 'ready' for document in documents)
