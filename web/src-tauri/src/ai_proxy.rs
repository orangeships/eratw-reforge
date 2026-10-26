use std::time::Duration;

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct AiHttpRequest {
    pub url: String,
    pub method: String,
    #[serde(rename = "apiKey")]
    pub api_key: String,
    pub body: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AiHttpResponse {
    pub status: u16,
    #[serde(rename = "contentType")]
    pub content_type: Option<String>,
    pub body: String,
}

fn request_method(method: &str) -> Result<reqwest::Method, String> {
    match method.trim().to_ascii_uppercase().as_str() {
        "GET" => Ok(reqwest::Method::GET),
        "POST" => Ok(reqwest::Method::POST),
        other => Err(format!("AI HTTP method is not allowed: {}", other)),
    }
}

/// Native adapter for user-selected OpenAI-compatible AI providers.
///
/// The renderer may select the destination, but this command accepts only
/// HTTP(S) URLs, rejects embedded URL credentials, and supports only the GET
/// and POST operations used by the provider adapter. The API key is kept in
/// the IPC argument and is never logged or persisted by this layer.
#[tauri::command]
pub async fn ai_http_request(request: AiHttpRequest) -> Result<AiHttpResponse, String> {
    let url = reqwest::Url::parse(request.url.trim())
        .map_err(|error| format!("invalid AI endpoint URL: {}", error))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("AI endpoint URL must use http or https".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("AI endpoint URL must not contain embedded credentials".to_string());
    }

    let method = request_method(&request.method)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|error| format!("failed to create AI HTTP client: {}", error))?;
    let mut builder = client.request(method, url);

    if !request.api_key.trim().is_empty() {
        builder = builder.header(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {}", request.api_key.trim()),
        );
    }
    if let Some(body) = request.body {
        builder = builder
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body);
    }

    let response = builder
        .send()
        .await
        .map_err(|error| format!("AI HTTP request failed: {}", error))?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned);
    let body = response
        .text()
        .await
        .map_err(|error| format!("failed to read AI HTTP response: {}", error))?;

    Ok(AiHttpResponse {
        status,
        content_type,
        body,
    })
}
