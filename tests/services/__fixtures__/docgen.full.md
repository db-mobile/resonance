# Golden & API

Covers <every> markdown branch

**Base URL:** `https://api.example.com`

## Table of Contents

- [GET Health](#get-health)
- [Users](#users)
  - [GET List users](#get-list-users)
  - [PUT /users/{id}/roles/{{role}}](#put-users-id-roles-role)
- [Users / Admin](#users-admin)
  - [POST Create admin](#post-create-admin)
  - [PATCH Patch admin](#patch-patch-admin)

### GET Health

Liveness probe

**URL:** `https://api.example.com/health`

#### Headers

| Name | Value | Description |
|------|-------|-------------|
| X-Tenant | acme | - |
| Accept | application/json | - |

#### Code Samples

**cURL (Command line)**

```bash
curl \
  -H 'X-Tenant: acme' \
  -H 'Accept: application/json' \
  'https://api.example.com/health'
```

**Python (requests library)**

```python
import requests

url = "https://api.example.com/health"

headers = {
    "X-Tenant": "acme",
    "Accept": "application/json"
}

response = requests.get(url, headers=headers)

print(response.status_code)
print(response.text)
```

**JavaScript (Fetch API)**

```javascript
fetch(`https://api.example.com/health`, {
  method: 'GET',
  headers: {
    'X-Tenant': 'acme',
    'Accept': 'application/json'
  },
})
  .then(response => response.text())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));
```

---

## Users

### GET List users

Paged list

**URL:** `https://api.example.com/users`

#### Query Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| page | integer | Yes | Page number |
| q | string | No | - |

#### Headers

| Name | Value | Description |
|------|-------|-------------|
| Accept | application/xml | - |
| X-Trace | - | Trace id |
| X-Tenant | acme | - |

#### Response Schema

```json
{
  "type": "array",
  "items": {
    "type": "object"
  }
}
```

#### Code Samples

**cURL (Command line)**

```bash
curl \
  -H 'Accept: application/xml' \
  -H 'X-Tenant: acme' \
  'https://api.example.com/users'
```

**Python (requests library)**

```python
import requests

url = "https://api.example.com/users"

headers = {
    "Accept": "application/xml",
    "X-Tenant": "acme"
}

response = requests.get(url, headers=headers)

print(response.status_code)
print(response.text)
```

**JavaScript (Fetch API)**

```javascript
fetch(`https://api.example.com/users`, {
  method: 'GET',
  headers: {
    'Accept': 'application/xml',
    'X-Tenant': 'acme'
  },
})
  .then(response => response.text())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));
```

---

### PUT /users/{id}/roles/{{role}}

**URL:** `https://api.example.com/users/{id}/roles/{{role}}`

#### Path Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| id | string | Yes | User id |
| role | string | No | - |

#### Headers

| Name | Value | Description |
|------|-------|-------------|
| X-Tenant | acme | - |
| Accept | application/json | - |

#### Request Body

**Content-Type:** `application/json`

```json
{"role":"owner"}
```

#### Code Samples

**cURL (Command line)**

```bash
curl \
  -X PUT \
  -H 'X-Tenant: acme' \
  -H 'Accept: application/json' \
  -d '{"role":"owner"}' \
  'https://api.example.com/users/7/roles/{role}'
```

**Python (requests library)**

```python
import requests

url = "https://api.example.com/users/7/roles/{role}"

headers = {
    "X-Tenant": "acme",
    "Accept": "application/json"
}

data = "{\"role\":\"owner\"}"

response = requests.put(url, headers=headers, data=data)

print(response.status_code)
print(response.text)
```

**JavaScript (Fetch API)**

```javascript
fetch(`https://api.example.com/users/7/roles/{role}`, {
  method: 'PUT',
  headers: {
    'X-Tenant': 'acme',
    'Accept': 'application/json'
  },
  body: `{
  "role": "owner"
}`
})
  .then(response => response.text())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));
```

---

## Users / Admin

### POST Create admin

**URL:** `https://api.example.com/admins`

#### Headers

| Name | Value | Description |
|------|-------|-------------|
| X-Tenant | acme | - |
| Accept | application/json | - |

#### Request Body

**Content-Type:** `application/json`

```json
not json
```

#### Code Samples

**cURL (Command line)**

```bash
curl \
  -X POST \
  -H 'X-Tenant: acme' \
  -H 'Accept: application/json' \
  -d 'not json' \
  'https://api.example.com/admins'
```

**Python (requests library)**

```python
import requests

url = "https://api.example.com/admins"

headers = {
    "X-Tenant": "acme",
    "Accept": "application/json"
}

data = "not json"

response = requests.post(url, headers=headers, data=data)

print(response.status_code)
print(response.text)
```

**JavaScript (Fetch API)**

```javascript
fetch(`https://api.example.com/admins`, {
  method: 'POST',
  headers: {
    'X-Tenant': 'acme',
    'Accept': 'application/json'
  },
  body: `not json`
})
  .then(response => response.text())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));
```

---

### PATCH Patch admin

**URL:** `https://api.example.com/admins/{id}`

#### Headers

| Name | Value | Description |
|------|-------|-------------|
| X-Tenant | acme | - |
| Accept | application/json | - |

#### Request Body

**Content-Type:** `application/json`

```json
{"patched":true}
```

#### Response Schema

```json
{
  "type": "object"
}
```

#### Code Samples

**cURL (Command line)**

```bash
curl \
  -X PATCH \
  -H 'X-Tenant: acme' \
  -H 'Accept: application/json' \
  -d '{"patched":true}' \
  'https://api.example.com/admins/{id}'
```

**Python (requests library)**

```python
import requests

url = "https://api.example.com/admins/{id}"

headers = {
    "X-Tenant": "acme",
    "Accept": "application/json"
}

data = "{\"patched\":true}"

response = requests.patch(url, headers=headers, data=data)

print(response.status_code)
print(response.text)
```

**JavaScript (Fetch API)**

```javascript
fetch(`https://api.example.com/admins/{id}`, {
  method: 'PATCH',
  headers: {
    'X-Tenant': 'acme',
    'Accept': 'application/json'
  },
  body: `{
  "patched": true
}`
})
  .then(response => response.text())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));
```

---

---

*Generated by Resonance on DATE*