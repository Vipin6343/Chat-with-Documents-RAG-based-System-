from conftest import workspace


def test_conversation_list_is_workspace_scoped(setup):
    client, _, _, _ = setup
    first, second = workspace(client), workspace(client)
    conversation = client.post(f'/api/workspaces/{first}/conversations').json()
    assert client.get(f'/api/workspaces/{first}/conversations').json() == [conversation]
    assert client.get(f'/api/workspaces/{second}/conversations').json() == []
    assert client.get('/api/workspaces/00000000-0000-0000-0000-000000000000/conversations').status_code == 404
