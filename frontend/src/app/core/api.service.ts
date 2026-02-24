import { Injectable } from '@angular/core';
import { HttpClient, HttpEvent, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { appConfig } from './app-config';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly baseUrl = appConfig.apiBaseUrl.replace(/\/$/, '');

  constructor(private readonly http: HttpClient) {}

  get<T>(path: string, params?: Record<string, string | number | boolean | string[] | number[] | undefined>, headers?: Record<string, string>): Observable<T> {
    const httpParams = this.buildParams(params);
    return this.http.get<T>(`${this.baseUrl}${path}`, { params: httpParams, headers });
  }

  post<T>(
    path: string,
    body: unknown,
    headers?: Record<string, string>,
    params?: Record<string, string | number | boolean | string[] | number[] | undefined>
  ): Observable<T> {
    const httpParams = this.buildParams(params);
    return this.http.post<T>(`${this.baseUrl}${path}`, body, { headers, params: httpParams });
  }

  postWithProgress<T>(
    path: string,
    body: unknown,
    headers?: Record<string, string>,
    params?: Record<string, string | number | boolean | string[] | number[] | undefined>
  ): Observable<HttpEvent<T>> {
    const httpParams = this.buildParams(params);
    return this.http.post<T>(`${this.baseUrl}${path}`, body, {
      headers,
      params: httpParams,
      observe: 'events',
      reportProgress: true,
    });
  }

  put<T>(
    path: string,
    body: unknown,
    headers?: Record<string, string>,
    params?: Record<string, string | number | boolean | string[] | number[] | undefined>
  ): Observable<T> {
    const httpParams = this.buildParams(params);
    return this.http.put<T>(`${this.baseUrl}${path}`, body, { headers, params: httpParams });
  }

  patch<T>(
    path: string,
    body: unknown,
    headers?: Record<string, string>,
    params?: Record<string, string | number | boolean | string[] | number[] | undefined>
  ): Observable<T> {
    const httpParams = this.buildParams(params);
    return this.http.patch<T>(`${this.baseUrl}${path}`, body, { headers, params: httpParams });
  }

  delete<T>(
    path: string,
    headers?: Record<string, string>,
    params?: Record<string, string | number | boolean | string[] | number[] | undefined>,
    body?: unknown
  ): Observable<T> {
    const httpParams = this.buildParams(params);
    const options: { headers?: Record<string, string>; params: HttpParams; body?: unknown } = { headers, params: httpParams };
    if (body !== undefined) {
      options.body = body;
    }
    return this.http.delete<T>(`${this.baseUrl}${path}`, options);
  }

  getBlob(path: string, params?: Record<string, string | number | boolean | string[] | number[] | undefined>, headers?: Record<string, string>): Observable<Blob> {
    const httpParams = this.buildParams(params);
    return this.http.get(`${this.baseUrl}${path}`, { params: httpParams, headers, responseType: 'blob' as const });
  }

  postBlob(
    path: string,
    body: unknown,
    params?: Record<string, string | number | boolean | string[] | number[] | undefined>,
    headers?: Record<string, string>
  ): Observable<Blob> {
    const httpParams = this.buildParams(params);
    return this.http.post(`${this.baseUrl}${path}`, body, { params: httpParams, headers, responseType: 'blob' as const });
  }

  private buildParams(params?: Record<string, string | number | boolean | string[] | number[] | undefined>): HttpParams {
    let httpParams = new HttpParams();
    if (!params) return httpParams;
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          value.forEach((val) => {
            httpParams = httpParams.append(key, String(val));
          });
        } else {
          httpParams = httpParams.set(key, String(value));
        }
      }
    });
    return httpParams;
  }
}

