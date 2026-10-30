import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface Employee {
  employeeId: string;
  firstName: string;
  lastName: string;
  designation: string;
  email: string;
}

export interface AttendanceRecord {
  employeeId: string;
  name: string;
  designation: string;
  workDate: string;
  checkIn: string;
  checkOut: string;
  status: 'Present' | 'Late' | 'On leave' | 'Half day leave';
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  type: string;
  startDate: string;
  endDate: string;
  days: number;
  status: 'Pending' | 'Approved' | 'Declined';
  reason?: string;
}

export interface PublicHoliday {
  id: number;
  date: string;
  name: string;
  description: string | null;
  source: 'CUSTOM';
}

export interface EmployeeProfile {
  employeeId: string;
  fatherName: string | null;
  motherName: string | null;
  permanentAddress: string | null;
  dateOfBirth: string | null;
  profileImageBase64: string | null;
  tenthMarks: number | null;
  intermediateType: '12th' | 'Diploma' | null;
  intermediateMarks: number | null;
  educationGroup: string | null;
  graduationQualification: string | null;
  graduationSpecialization: string | null;
  graduationGroup: string | null;
  postgraduateQualification: string | null;
  postgraduateSpecialization: string | null;
  aadhaarNumber: string | null;
  panNumber: string | null;
  skills: string[];
  certifications: string[];
}

export type EmployeeProfilePayload = Omit<EmployeeProfile, 'employeeId'>;

interface RegisterPayload {
  employeeId: string;
  firstName: string;
  lastName: string;
  designation: string;
  email: string;
  password: string;
}

export interface LeaveRequestPayload {
  employeeId: string;
  type: string;
  startDate: string;
  endDate: string;
  reason: string;
}

interface LoginPayload {
  employeeId: string;
  password: string;
}

@Injectable({ providedIn: 'root' })
export class PeopleApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = 'http://localhost:8080/api';

  login(payload: LoginPayload): Observable<Employee> {
    return this.http.post<Employee>(`${this.baseUrl}/auth/login`, payload);
  }

  register(payload: RegisterPayload): Observable<unknown> {
    return this.http.post(`${this.baseUrl}/auth/register`, payload);
  }

  getEmployees(): Observable<Employee[]> {
    return this.http.get<Employee[]>(`${this.baseUrl}/employees`);
  }

  deleteEmployee(employeeId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/employees/${encodeURIComponent(employeeId)}`);
  }

  getAttendance(employeeId: string): Observable<AttendanceRecord[]> {
    return this.http.get<AttendanceRecord[]>(`${this.baseUrl}/attendance?employeeId=${encodeURIComponent(employeeId)}`);
  }

  getAttendanceMonth(employeeId: string, year: number, month: number): Observable<AttendanceRecord[]> {
    const query = new URLSearchParams({ employeeId, year: String(year), month: String(month) });
    return this.http.get<AttendanceRecord[]>(`${this.baseUrl}/attendance/month?${query.toString()}`);
  }

  checkIn(employeeId: string): Observable<AttendanceRecord> {
    return this.http.put<AttendanceRecord>(`${this.baseUrl}/attendance/${encodeURIComponent(employeeId)}/check-in`, {});
  }

  checkOut(employeeId: string): Observable<AttendanceRecord> {
    return this.http.put<AttendanceRecord>(`${this.baseUrl}/attendance/${encodeURIComponent(employeeId)}/check-out`, {});
  }

  getLeaveRequests(): Observable<LeaveRequest[]> {
    return this.http.get<LeaveRequest[]>(`${this.baseUrl}/leave-requests`);
  }

  createLeaveRequest(payload: LeaveRequestPayload): Observable<LeaveRequest> {
    return this.http.post<LeaveRequest>(`${this.baseUrl}/leave-requests`, payload);
  }

  updateLeaveRequest(requestId: string, payload: { status: 'Approved' | 'Declined'; reviewerEmployeeId: string }): Observable<LeaveRequest> {
    return this.http.put<LeaveRequest>(`${this.baseUrl}/leave-requests/${encodeURIComponent(requestId)}`, payload);
  }

  getPublicHolidays(): Observable<PublicHoliday[]> {
    return this.http.get<PublicHoliday[]>(`${this.baseUrl}/public-holidays`);
  }

  createPublicHoliday(payload: { date: string; name: string; description: string; employeeId: string }): Observable<PublicHoliday> {
    return this.http.post<PublicHoliday>(`${this.baseUrl}/public-holidays`, payload);
  }

  deletePublicHoliday(holidayId: number, employeeId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/public-holidays/${holidayId}?employeeId=${encodeURIComponent(employeeId)}`);
  }

  getEmployeeProfile(employeeId: string): Observable<EmployeeProfile> {
    return this.http.get<EmployeeProfile>(`${this.baseUrl}/employees/${encodeURIComponent(employeeId)}/profile`);
  }

  saveEmployeeProfile(employeeId: string, payload: EmployeeProfilePayload): Observable<EmployeeProfile> {
    return this.http.put<EmployeeProfile>(`${this.baseUrl}/employees/${encodeURIComponent(employeeId)}/profile`, payload);
  }
}
