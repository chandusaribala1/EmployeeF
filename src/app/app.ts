import { HttpErrorResponse } from '@angular/common/http';
import { UpperCasePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable, firstValueFrom } from 'rxjs';
import { AttendanceRecord, Employee, EmployeeProfile, EmployeeProfilePayload, LeaveRequest, PeopleApiService, PublicHoliday } from './people-api.service';

type SectionKey = 'overview' | 'attendance' | 'leave' | 'holidays' | 'employees' | 'profile';
type AuthMode = 'login' | 'register';
type ProfileStep = 'view' | 'personal' | 'education' | 'skills' | 'additional';
type AttendanceCalendarStatus = 'present' | 'exception' | 'half-day-leave' | 'full-day-leave' | 'holiday' | 'week-off' | 'no-record';
interface AttendanceCalendarDay {
  day: number;
  isoDate: string;
  status: AttendanceCalendarStatus;
  label: string;
  holidayName: string;
  today: boolean;
}

const EMPTY_EMPLOYEE: Employee = { employeeId: '', firstName: '', lastName: '', designation: '', email: '' };

@Component({
  imports: [ReactiveFormsModule, UpperCasePipe],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {
  private readonly formBuilder = inject(FormBuilder);
  private readonly api = inject(PeopleApiService);

  protected readonly authMode = signal<AuthMode>('login');
  protected readonly activeSection = signal<SectionKey>('overview');
  protected readonly isAuthenticated = signal(false);
  protected readonly mobileMenuOpen = signal(false);
  protected readonly employees = signal<Employee[]>([]);
  protected readonly attendance = signal<AttendanceRecord[]>([]);
  protected readonly calendarAttendance = signal<AttendanceRecord[]>([]);
  protected readonly calendarMonth = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  protected readonly calendarTitle = computed(() => new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(this.calendarMonth()));
  protected readonly calendarCells = computed((): (AttendanceCalendarDay | null)[] => {
    const month = this.calendarMonth();
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    const prefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}-`;
    const records = new Map(this.calendarAttendance().filter((record) => record.workDate.startsWith(prefix)).map((record) => [record.workDate, record]));
    const holidays = new Map(this.publicHolidays().filter((holiday) => holiday.date.startsWith(prefix)).map((holiday) => [holiday.date, holiday.name]));
    const today = this.localDateString(new Date());
    const leadingDays = new Date(year, monthIndex, 1).getDay();
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const cells: (AttendanceCalendarDay | null)[] = Array.from({ length: leadingDays }, () => null);
    for (let day = 1; day <= daysInMonth; day++) {
      const isoDate = `${prefix}${String(day).padStart(2, '0')}`;
      const record = records.get(isoDate);
      const holidayName = holidays.get(isoDate) ?? '';
      const weekday = new Date(year, monthIndex, day).getDay();
      const approvedLeave = this.leaveRequests().some((request) => request.employeeId === this.currentEmployee().employeeId
        && request.status === 'Approved' && request.startDate <= isoDate && request.endDate >= isoDate);
      let status: AttendanceCalendarStatus = 'no-record';
      let label = 'No record';
      if (record?.status === 'Present') { status = 'present'; label = 'Present'; }
      else if (record?.status === 'Late') { status = 'exception'; label = 'Exception'; }
      else if (record?.status === 'Half day leave') { status = 'half-day-leave'; label = 'Half day leave'; }
      else if (record?.status === 'On leave') { status = 'full-day-leave'; label = 'Full day leave'; }
      else if (holidayName) { status = 'holiday'; label = holidayName; }
      else if (approvedLeave && weekday !== 0 && weekday !== 6) { status = 'full-day-leave'; label = 'Full day leave'; }
      else if (weekday === 0 || weekday === 6) { status = 'week-off'; label = 'Week off'; }
      cells.push({ day, isoDate, status, label, holidayName, today: isoDate === today });
    }
    return cells;
  });
  protected readonly leaveRequests = signal<LeaveRequest[]>([]);
  protected readonly publicHolidays = signal<PublicHoliday[]>([]);
  protected readonly upcomingHolidays = computed(() => {
    const today = this.localDateString(new Date());
    return this.publicHolidays().filter((holiday) => holiday.date >= today).slice(0, 5);
  });
  protected readonly employeeProfile = signal<EmployeeProfile | null>(null);
  protected readonly currentEmployee = signal<Employee>(EMPTY_EMPLOYEE);
  protected readonly profileStep = signal<ProfileStep>('view');
  protected readonly profileImageError = signal('');
  protected readonly profileImageBase64 = signal<string | null>(null);
  protected readonly skillInput = signal('');
  protected readonly certificationInput = signal('');
  protected readonly selectedSkills = signal<string[]>([]);
  protected readonly selectedCertifications = signal<string[]>([]);
  protected readonly skillSuggestions = ['Java', 'Spring Boot', 'SQL', 'PostgreSQL', 'Angular', 'TypeScript', 'Communication', 'Leadership'];
  protected readonly apiAvailable = signal<boolean | null>(null);
  protected readonly notice = signal('');
  protected readonly leaveDialogOpen = signal(false);
  protected readonly holidayEditorOpen = signal(false);
  protected readonly holidayFilter = signal<'upcoming' | 'all'>('upcoming');
  protected readonly holidayYear = signal(new Date().getFullYear());
  protected readonly holidayRows = computed(() => {
    const today = this.localDateString(new Date());
    return this.publicHolidays()
      .filter((holiday) => holiday.date.startsWith(`${this.holidayYear()}-`))
      .filter((holiday) => this.holidayFilter() === 'all' || holiday.date >= today)
      .sort((left, right) => left.date.localeCompare(right.date));
  });
  protected readonly upcomingHolidayCount = computed(() => {
    const today = this.localDateString(new Date());
    return this.publicHolidays().filter((holiday) => holiday.date.startsWith(`${this.holidayYear()}-`) && holiday.date >= today).length;
  });
  protected readonly presentCount = computed(() => this.attendance().filter((entry) => entry.status === 'Present').length);
  protected readonly pendingLeaveCount = computed(() => this.leaveRequests().filter((request) => request.status === 'Pending').length);
  protected readonly designations = computed(() => [...new Set(this.employees().map((employee) => employee.designation))].sort((left, right) => left.localeCompare(right)));
  protected readonly isHr = computed(() => /\bhr\b|human resources?/i.test(this.currentEmployee().designation));
  protected readonly todayLabel = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date());

  protected readonly loginForm = this.formBuilder.nonNullable.group({
    employeeId: ['', Validators.required],
    password: ['', Validators.required],
  });

  protected readonly registerForm = this.formBuilder.nonNullable.group({
    employeeId: ['', [Validators.required, Validators.pattern('[A-Za-z0-9-]{3,32}')]],
    firstName: ['', [Validators.required, Validators.maxLength(80)]],
    lastName: ['', [Validators.required, Validators.maxLength(80)]],
    designation: ['', [Validators.required, Validators.maxLength(120)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(180)]],
    password: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(72), Validators.pattern(/^[A-Z](?=.*[0-9]).{5,71}$/)]],
    confirmPassword: ['', Validators.required],
  }, { validators: (group) => group.get('password')?.value === group.get('confirmPassword')?.value ? null : { passwordMismatch: true } });

  protected readonly leaveForm = this.formBuilder.nonNullable.group({
    type: ['Annual leave', Validators.required],
    startDate: ['', Validators.required],
    endDate: ['', Validators.required],
    reason: ['', Validators.required],
  }, { validators: (group) => {
    const startDate = group.get('startDate')?.value;
    const endDate = group.get('endDate')?.value;
    return startDate && endDate && endDate < startDate ? { invalidDateRange: true } : null;
  } });

  protected readonly holidayForm = this.formBuilder.nonNullable.group({
    date: ['', Validators.required],
    name: ['', [Validators.required, Validators.maxLength(120)]],
    description: ['', Validators.maxLength(500)],
  });

  protected readonly profileForm = this.formBuilder.nonNullable.group({
    fatherName: ['', [Validators.required, Validators.maxLength(120)]],
    motherName: ['', [Validators.required, Validators.maxLength(120)]],
    permanentAddress: ['', [Validators.required, Validators.maxLength(4000)]],
    dateOfBirth: ['', Validators.required],
    tenthMarks: ['', [Validators.required, Validators.min(0), Validators.max(100)]],
    intermediateType: ['12th', Validators.required],
    intermediateMarks: ['', [Validators.required, Validators.min(0), Validators.max(100)]],
    educationGroup: ['', [Validators.required, Validators.maxLength(120)]],
    graduationQualification: ['', [Validators.required, Validators.maxLength(120)]],
    graduationSpecialization: ['', Validators.maxLength(160)],
    graduationGroup: ['', Validators.maxLength(120)],
    postgraduateApplicable: [false],
    postgraduateQualification: ['', Validators.maxLength(120)],
    postgraduateSpecialization: ['', Validators.maxLength(160)],
    aadhaarNumber: ['', Validators.pattern(/^$|^[0-9]{12}$/)],
    panNumber: ['', Validators.pattern(/^$|^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/)],
  });

  protected readonly navigation: { key: SectionKey; label: string; icon: string }[] = [
    { key: 'overview', label: 'Overview', icon: '◫' },
    { key: 'attendance', label: 'Attendance', icon: '◷' },
    { key: 'leave', label: 'Leave requests', icon: '▤' },
    { key: 'holidays', label: 'Public holidays', icon: '☼' },
    { key: 'employees', label: 'Employees', icon: '♙' },
    { key: 'profile', label: 'My profile', icon: '◎' },
  ];

  protected setAuthMode(mode: AuthMode): void {
    this.authMode.set(mode);
    this.notice.set('');
  }

  protected async login(): Promise<void> {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }
    try {
      const employee = await firstValueFrom(this.api.login(this.loginForm.getRawValue()));
      this.apiAvailable.set(true);
      this.enterDashboard(employee);
    } catch (error) {
      this.apiAvailable.set(!this.isNetworkUnavailable(error));
      this.notice.set(this.isNetworkUnavailable(error)
        ? 'The employee service is unavailable. No session was started.'
        : 'Your employee ID or password was not accepted.');
    }
  }

  protected async register(): Promise<void> {
    if (this.registerForm.invalid) {
      this.registerForm.markAllAsTouched();
      return;
    }
    const { confirmPassword, ...payload } = this.registerForm.getRawValue();
    try {
      await firstValueFrom(this.api.register(payload));
      this.apiAvailable.set(true);
      this.registerForm.reset();
      this.loginForm.reset({ employeeId: payload.employeeId.toUpperCase(), password: '' });
      this.authMode.set('login');
      this.notice.set('Account created. Sign in with your employee ID and password.');
    } catch (error) {
      this.apiAvailable.set(!this.isNetworkUnavailable(error));
      this.notice.set(this.isNetworkUnavailable(error)
        ? 'The employee service is unavailable. Your account was not created.'
        : 'Could not create your account. Check the details and try again.');
    }
  }

  protected selectSection(section: SectionKey): void {
    this.activeSection.set(section);
    this.mobileMenuOpen.set(false);
    this.notice.set('');
  }

  protected shiftCalendarMonth(offset: number): void {
    const month = this.calendarMonth();
    const nextMonth = new Date(month.getFullYear(), month.getMonth() + offset, 1);
    this.calendarMonth.set(nextMonth);
    void this.loadCalendarAttendance(nextMonth);
  }

  protected shiftHolidayYear(offset: number): void {
    this.holidayYear.update((year) => year + offset);
  }

  protected holidayDay(isoDate: string): string { return String(Number(isoDate.slice(8, 10))); }
  protected holidayMonth(isoDate: string): string {
    return new Intl.DateTimeFormat('en', { month: 'short' }).format(new Date(`${isoDate}T00:00:00`)).toUpperCase();
  }
  protected holidayWeekday(isoDate: string): string {
    return new Intl.DateTimeFormat('en', { weekday: 'long' }).format(new Date(`${isoDate}T00:00:00`));
  }

  protected async checkIn(): Promise<void> {
    const employeeId = this.currentEmployee().employeeId;
    await this.performApi(this.api.checkIn(employeeId), (record) => this.upsertAttendance(record), 'Could not save check-in.');
  }

  protected async checkOut(): Promise<void> {
    const employeeId = this.currentEmployee().employeeId;
    await this.performApi(this.api.checkOut(employeeId), (record) => this.upsertAttendance(record), 'Could not save check-out.');
  }

  protected async submitLeave(): Promise<void> {
    if (this.leaveForm.invalid) {
      this.leaveForm.markAllAsTouched();
      return;
    }
    const payload = { ...this.leaveForm.getRawValue(), employeeId: this.currentEmployee().employeeId };
    const saved = await this.performApi(this.api.createLeaveRequest(payload),
      (request) => this.leaveRequests.update((items) => [request, ...items]), 'Could not save leave request.');
    if (saved) {
      this.leaveDialogOpen.set(false);
      this.leaveForm.reset({ type: 'Annual leave', startDate: '', endDate: '', reason: '' });
    }
  }

  protected async updateLeave(request: LeaveRequest, status: 'Approved' | 'Declined'): Promise<void> {
    await this.performApi(this.api.updateLeaveRequest(request.id, { status, reviewerEmployeeId: this.currentEmployee().employeeId }),
      (updated) => this.leaveRequests.update((items) => items.map((item) => item.id === updated.id ? updated : item)),
      `Could not ${status.toLowerCase()} leave request.`);
  }

  protected async addPublicHoliday(): Promise<void> {
    if (this.holidayForm.invalid) {
      this.holidayForm.markAllAsTouched();
      return;
    }
    const payload = { ...this.holidayForm.getRawValue(), employeeId: this.currentEmployee().employeeId };
    const saved = await this.performApi(this.api.createPublicHoliday(payload), (holiday) => {
      this.publicHolidays.update((items) => [...items, holiday].sort((left, right) => left.date.localeCompare(right.date)));
    }, 'Could not save the public holiday.');
    if (saved) {
      this.holidayForm.reset({ date: '', name: '', description: '' });
      this.holidayEditorOpen.set(false);
    }
  }

  protected async removePublicHoliday(holiday: PublicHoliday): Promise<void> {
    await this.performApi(this.api.deletePublicHoliday(holiday.id, this.currentEmployee().employeeId), () => {
      this.publicHolidays.update((items) => items.filter((item) => item.id !== holiday.id));
    }, 'Could not remove the public holiday.');
  }

  protected leaveWorkingDays(): number {
    const { startDate, endDate } = this.leaveForm.getRawValue();
    return startDate && endDate && endDate >= startDate ? this.countWorkingDays(startDate, endDate) : 0;
  }

  protected openProfileEditor(): void {
    const profile = this.employeeProfile();
    this.profileForm.reset({
      fatherName: profile?.fatherName ?? '',
      motherName: profile?.motherName ?? '',
      permanentAddress: profile?.permanentAddress ?? '',
      dateOfBirth: profile?.dateOfBirth ?? '',
      tenthMarks: profile?.tenthMarks?.toString() ?? '',
      intermediateType: profile?.intermediateType ?? '12th',
      intermediateMarks: profile?.intermediateMarks?.toString() ?? '',
      educationGroup: profile?.educationGroup ?? '',
      graduationQualification: profile?.graduationQualification ?? '',
      graduationSpecialization: profile?.graduationSpecialization ?? '',
      graduationGroup: profile?.graduationGroup ?? '',
      postgraduateApplicable: !!profile?.postgraduateQualification,
      postgraduateQualification: profile?.postgraduateQualification ?? '',
      postgraduateSpecialization: profile?.postgraduateSpecialization ?? '',
      aadhaarNumber: profile?.aadhaarNumber ?? '',
      panNumber: profile?.panNumber ?? '',
    });
    this.profileImageBase64.set(profile?.profileImageBase64 ?? null);
    this.selectedSkills.set(profile?.skills ?? []);
    this.selectedCertifications.set(profile?.certifications ?? []);
    this.profileImageError.set('');
    this.profileStep.set('personal');
  }

  protected nextProfileStep(): void {
    const requiredFields = this.profileStep() === 'personal'
      ? ['fatherName', 'motherName', 'permanentAddress', 'dateOfBirth']
      : this.profileStep() === 'education'
        ? ['tenthMarks', 'intermediateType', 'intermediateMarks', 'educationGroup', 'graduationQualification']
        : [];
    for (const field of requiredFields) this.profileForm.get(field)?.markAsTouched();
    if (requiredFields.some((field) => this.profileForm.get(field)?.invalid)) {
      this.notice.set('Complete the required fields before continuing.');
      return;
    }
    this.notice.set('');
    if (this.profileStep() === 'personal') this.profileStep.set('education');
    else if (this.profileStep() === 'education') this.profileStep.set('skills');
    else if (this.profileStep() === 'skills') this.profileStep.set('additional');
  }

  protected previousProfileStep(): void {
    if (this.profileStep() === 'education') this.profileStep.set('personal');
    else if (this.profileStep() === 'skills') this.profileStep.set('education');
    else if (this.profileStep() === 'additional') this.profileStep.set('skills');
  }

  protected cancelProfileEdit(): void {
    this.profileStep.set('view');
    this.profileImageError.set('');
  }

  protected async chooseProfileImage(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (file.type !== 'image/png' || file.size > 3 * 1024 * 1024) {
      this.profileImageError.set('Choose a PNG image no larger than 3 MB.');
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        this.profileImageBase64.set(result.slice(result.indexOf(',') + 1));
        this.profileImageError.set('');
      }
    };
    reader.onerror = () => this.profileImageError.set('Could not read this image. Choose another PNG file.');
    reader.readAsDataURL(file);
  }

  protected addSkill(value = this.skillInput()): void {
    const skill = value.trim();
    if (!skill || this.selectedSkills().some((item) => item.toLowerCase() === skill.toLowerCase())) return;
    this.selectedSkills.update((items) => [...items, skill]);
    this.skillInput.set('');
  }

  protected removeSkill(skill: string): void {
    this.selectedSkills.update((items) => items.filter((item) => item !== skill));
  }

  protected addCertification(): void {
    const certification = this.certificationInput().trim();
    if (!certification || this.selectedCertifications().some((item) => item.toLowerCase() === certification.toLowerCase())) return;
    this.selectedCertifications.update((items) => [...items, certification]);
    this.certificationInput.set('');
  }

  protected removeCertification(certification: string): void {
    this.selectedCertifications.update((items) => items.filter((item) => item !== certification));
  }

  protected async saveProfile(): Promise<void> {
    if (this.profileForm.invalid || this.selectedSkills().length > 50 || this.selectedCertifications().length > 100) {
      this.profileForm.markAllAsTouched();
      this.notice.set('Complete the required profile fields and check the Aadhaar and PAN formats.');
      return;
    }
    const form = this.profileForm.getRawValue();
    const payload: EmployeeProfilePayload = {
      fatherName: form.fatherName,
      motherName: form.motherName,
      permanentAddress: form.permanentAddress,
      dateOfBirth: form.dateOfBirth,
      profileImageBase64: this.profileImageBase64(),
      tenthMarks: Number(form.tenthMarks),
      intermediateType: form.intermediateType as '12th' | 'Diploma',
      intermediateMarks: Number(form.intermediateMarks),
      educationGroup: form.educationGroup,
      graduationQualification: form.graduationQualification,
      graduationSpecialization: form.graduationSpecialization || null,
      graduationGroup: form.graduationGroup || null,
      postgraduateQualification: form.postgraduateApplicable ? form.postgraduateQualification || null : null,
      postgraduateSpecialization: form.postgraduateApplicable ? form.postgraduateSpecialization || null : null,
      aadhaarNumber: form.aadhaarNumber || null,
      panNumber: form.panNumber.toUpperCase() || null,
      skills: this.selectedSkills(),
      certifications: this.selectedCertifications(),
    };
    await this.performApi(this.api.saveEmployeeProfile(this.currentEmployee().employeeId, payload), (profile) => {
      this.employeeProfile.set(profile);
      this.profileImageBase64.set(profile.profileImageBase64);
      this.profileStep.set('view');
    }, 'Could not save profile details.');
  }

  protected async removeEmployee(employee: Employee): Promise<void> {
    await this.performApi(this.api.deleteEmployee(employee.employeeId), () => {
      this.employees.update((items) => items.filter((item) => item.employeeId !== employee.employeeId));
      this.attendance.update((items) => items.filter((item) => item.employeeId !== employee.employeeId));
      this.leaveRequests.update((items) => items.filter((item) => item.employeeId !== employee.employeeId));
    }, 'Could not remove employee.');
  }

  protected signOut(): void {
    this.isAuthenticated.set(false);
    this.authMode.set('login');
    this.currentEmployee.set(EMPTY_EMPLOYEE);
    this.employees.set([]);
    this.attendance.set([]);
    this.calendarAttendance.set([]);
    this.leaveRequests.set([]);
    this.publicHolidays.set([]);
    this.employeeProfile.set(null);
    this.notice.set('');
  }

  protected fullName(): string {
    return `${this.currentEmployee().firstName} ${this.currentEmployee().lastName}`;
  }

  protected initials(employee: Employee): string {
    return `${employee.firstName.charAt(0)}${employee.lastName.charAt(0)}`.toUpperCase();
  }

  protected currentAttendance(): AttendanceRecord | undefined {
    return this.attendance().find((entry) => entry.employeeId === this.currentEmployee().employeeId);
  }

  protected hasCheckedIn(): boolean {
    const checkIn = this.currentAttendance()?.checkIn;
    return !!checkIn && checkIn !== '—';
  }

  protected hasCheckedOut(): boolean {
    const checkOut = this.currentAttendance()?.checkOut;
    return !!checkOut && checkOut !== '—';
  }

  private enterDashboard(employee: Employee): void {
    this.currentEmployee.set(employee);
    this.isAuthenticated.set(true);
    this.activeSection.set('overview');
    void this.loadRemoteData();
  }

  private async loadRemoteData(): Promise<void> {
    try {
      const employeeId = this.currentEmployee().employeeId;
      const month = this.calendarMonth();
      const [employees, attendance, monthAttendance, leaveRequests, publicHolidays, employeeProfile] = await Promise.all([
        firstValueFrom(this.api.getEmployees()),
        firstValueFrom(this.api.getAttendance(employeeId)),
        firstValueFrom(this.api.getAttendanceMonth(employeeId, month.getFullYear(), month.getMonth() + 1)),
        firstValueFrom(this.api.getLeaveRequests()),
        firstValueFrom(this.api.getPublicHolidays()),
        firstValueFrom(this.api.getEmployeeProfile(employeeId)),
      ]);
      this.employees.set(employees);
      this.attendance.set(attendance);
      this.calendarAttendance.set(monthAttendance);
      this.leaveRequests.set(leaveRequests);
      this.publicHolidays.set(publicHolidays);
      this.employeeProfile.set(employeeProfile);
      this.apiAvailable.set(true);
    } catch {
      this.apiAvailable.set(false);
      this.notice.set('Could not load employee data from the database.');
    }
  }

  private async performApi<T>(request: Observable<T>, update: (response: T) => void, failureMessage: string): Promise<boolean> {
    try {
      const response = await firstValueFrom(request);
      update(response);
      this.apiAvailable.set(true);
      this.notice.set('Changes saved to the database.');
      return true;
    } catch (error) {
      this.apiAvailable.set(!this.isNetworkUnavailable(error));
      this.notice.set(this.isNetworkUnavailable(error)
        ? 'Database connection unavailable. No changes were saved.'
        : this.apiErrorMessage(error) ?? failureMessage);
      return false;
    }
  }

  private upsertAttendance(record: AttendanceRecord): void {
    this.attendance.update((items) => items.some((item) => item.employeeId === record.employeeId)
      ? items.map((item) => item.employeeId === record.employeeId ? record : item)
      : [record, ...items]);
    this.calendarAttendance.update((items) => items.some((item) => item.workDate === record.workDate)
      ? items.map((item) => item.workDate === record.workDate ? record : item)
      : [...items, record].sort((left, right) => left.workDate.localeCompare(right.workDate)));
  }

  private async loadCalendarAttendance(month: Date): Promise<void> {
    const employeeId = this.currentEmployee().employeeId;
    if (!employeeId) return;
    try {
      const records = await firstValueFrom(this.api.getAttendanceMonth(employeeId, month.getFullYear(), month.getMonth() + 1));
      const currentMonth = this.calendarMonth();
      if (currentMonth.getFullYear() === month.getFullYear() && currentMonth.getMonth() === month.getMonth()) {
        this.calendarAttendance.set(records);
      }
    } catch {
      this.apiAvailable.set(false);
      this.notice.set('Could not load attendance for this month.');
    }
  }

  private countWorkingDays(startDate: string, endDate: string): number {
    const holidays = new Set(this.publicHolidays().map((holiday) => holiday.date));
    let count = 0;
    const date = new Date(`${startDate}T00:00:00Z`);
    const lastDate = new Date(`${endDate}T00:00:00Z`);
    while (date <= lastDate) {
      const day = date.getUTCDay();
      const isoDate = date.toISOString().slice(0, 10);
      if (day !== 0 && day !== 6 && !holidays.has(isoDate)) count++;
      date.setUTCDate(date.getUTCDate() + 1);
    }
    return count;
  }

  private localDateString(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private isNetworkUnavailable(error: unknown): boolean {
    return error instanceof HttpErrorResponse && error.status === 0;
  }

  private apiErrorMessage(error: unknown): string | null {
    if (!(error instanceof HttpErrorResponse) || typeof error.error !== 'object' || error.error === null) return null;
    if ('message' in error.error && typeof error.error.message === 'string') return error.error.message;
    return null;
  }
}
