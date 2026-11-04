import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable, firstValueFrom } from 'rxjs';
import { AttendanceRecord, Employee, EmployeeProfile, EmployeeProfilePayload, LeaveRequest, PeopleApiService, PublicHoliday } from './people-api.service';

type SectionKey = 'overview' | 'attendance' | 'leave' | 'resignation' | 'letters' | 'holidays' | 'profile';
type AuthMode = 'login' | 'register' | 'forgot' | 'reset';
type ProfileStep = 'view' | 'personal' | 'education' | 'skills' | 'additional';
type AttendanceCalendarStatus = 'present' | 'exception' | 'lop' | 'half-day-leave' | 'full-day-leave' | 'holiday' | 'week-off' | 'no-record';
interface AttendanceCalendarDay {
  day: number;
  isoDate: string;
  status: AttendanceCalendarStatus;
  label: string;
  holidayName: string;
  today: boolean;
}
interface ResignationRow { id: string; employeeName: string; appliedDate: string; noticePeriod: number; tentativeDate: string; actualDate: string; approver: string; reason: string; comments: string; }
interface ProfileSkillRow { name: string; type: string; level: string; }
type ProfileFileKey = 'relievingLetter' | 'experienceCertificate' | 'aadhaarPhoto' | 'panPhoto' | 'passportPhoto' | 'resume' | 'resignationLetter' | 'profilePhoto' | 'cancelledCheque';

const EMPTY_EMPLOYEE: Employee = { employeeId: '', firstName: '', lastName: '', designation: '', email: '' };

@Component({
  imports: [ReactiveFormsModule],
  selector: 'app-root',
  templateUrl: './app.html',
  host: { '(window:popstate)': 'restoreSectionFromHistory($event)' },
})
export class App {
  private readonly formBuilder = inject(FormBuilder);
  private readonly api = inject(PeopleApiService);

  protected readonly authMode = signal<AuthMode>('login');
  protected readonly activeSection = signal<SectionKey>('overview');
  protected readonly isAuthenticated = signal(false);
  protected readonly mobileMenuOpen = signal(false);
  protected readonly employees = signal<Employee[]>([]);
  protected readonly employeeSearch = signal('');
  protected readonly employeePage = signal(1);
  protected readonly employeePageSize = 5;
  protected readonly employeePageCount = computed(() => Math.max(1, Math.ceil(this.filteredEmployees().length / this.employeePageSize)));
  protected readonly employeePageNumbers = computed(() => {
    const total = this.employeePageCount();
    const current = Math.min(this.employeePage(), total);
    if (total <= 4) return Array.from({ length: total }, (_, index) => index + 1);
    if (current <= 2) return [1, 2, 0, total];
    if (current >= total - 1) return [1, 0, total - 1, total];
    return [1, 0, current, 0, total];
  });
  protected readonly pagedEmployees = computed(() => {
    const page = Math.min(this.employeePage(), this.employeePageCount());
    return this.filteredEmployees().slice((page - 1) * this.employeePageSize, page * this.employeePageSize);
  });
  protected readonly employeePageStart = computed(() => this.filteredEmployees().length === 0 ? 0 : (Math.min(this.employeePage(), this.employeePageCount()) - 1) * this.employeePageSize + 1);
  protected readonly employeePageEnd = computed(() => Math.min(this.employeePage() * this.employeePageSize, this.filteredEmployees().length));
  protected readonly attendanceSearch = signal('');
  protected readonly attendanceMonth = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  protected readonly attendanceMonthTitle = computed(() => new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(this.attendanceMonth()));
  protected readonly filteredEmployees = computed(() => {
    const query = this.employeeSearch().trim().toLowerCase();
    return this.employees()
      .filter((employee) => `${employee.firstName} ${employee.lastName} ${employee.employeeId} ${employee.email} ${employee.designation}`.toLowerCase().includes(query))
      .sort((left, right) => right.employeeId.localeCompare(left.employeeId, 'en', { numeric: true }));
  });
  protected readonly filteredAttendance = computed(() => [this.currentEmployee()].filter((employee) => `${employee.firstName} ${employee.lastName} ${employee.employeeId}`.toLowerCase().includes(this.attendanceSearch().toLowerCase())).map((employee) => {
    const month = this.attendanceMonth();
    const prefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-`;
    const records = this.calendarAttendance().filter((record) => record.employeeId === employee.employeeId && record.workDate.startsWith(prefix));
    const presentDays = records.filter((record) => record.status === 'Present' || record.status === 'Late').length;
    const leaveDays = records.filter((record) => record.status === 'On leave' || record.status === 'Half day leave').length;
    const workingDays = this.countMonthWorkingDays(month);
    const attendanceByDate = new Map(records.map((record) => [record.workDate, record]));
    let lopDays = 0;
    const today = this.localDateString(new Date());
    for (let day = 1; day <= new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(); day++) {
      const date = `${prefix}${String(day).padStart(2, '0')}`;
      const dateObject = new Date(month.getFullYear(), month.getMonth(), day);
      const weekday = dateObject.getDay();
      const holiday = this.publicHolidays().some((item) => item.date === date);
      const approvedLeave = this.leaveRequests().some((request) => request.employeeId === employee.employeeId
        && request.status === 'Approved' && request.startDate <= date && request.endDate >= date);
      if (date >= today || weekday === 0 || weekday === 6 || holiday || approvedLeave) continue;
      const record = attendanceByDate.get(date);
      if (!record || record.status === 'LOP' || !this.hasPunch(record.checkIn) || !this.hasPunch(record.checkOut)) lopDays++;
    }
    return { employee, workingDays, presentDays, leaveDays, lopDays };
  }));
  protected readonly resignations = signal<ResignationRow[]>([]);
  protected readonly profileTab = signal('Basic Information');
  protected readonly profileSkills = signal<ProfileSkillRow[]>([]);
  protected readonly selectedProfileFiles = signal<Record<string, string>>({});
  protected readonly profileFileData = signal<Record<string, string>>({});
  protected readonly profileFileDates = signal<Record<string, string>>({});
  protected readonly employeeDocumentFields: { key: ProfileFileKey; label: string }[] = [
    { key: 'relievingLetter', label: 'Relieving letter' }, { key: 'experienceCertificate', label: 'Experience certificate' },
    { key: 'aadhaarPhoto', label: 'Aadhaar photo' }, { key: 'panPhoto', label: 'PAN photo' },
    { key: 'passportPhoto', label: 'Passport photo' }, { key: 'resume', label: 'Updated resume' },
    { key: 'resignationLetter', label: 'Resignation acceptance letter' }, { key: 'profilePhoto', label: 'Passport size photo' },
    { key: 'cancelledCheque', label: 'Cancelled cheque' },
  ];
  protected readonly letterFields: { key: ProfileFileKey; label: string }[] = [
    { key: 'relievingLetter', label: 'Relieving letter' },
    { key: 'experienceCertificate', label: 'Experience certificate' },
    { key: 'resignationLetter', label: 'Resignation acceptance letter' },
  ];
  protected readonly myLetters = computed(() => this.letterFields
    .filter((field) => !!this.selectedProfileFiles()[field.key])
    .map((field) => ({ ...field, fileName: this.selectedProfileFiles()[field.key], date: this.profileFileDates()[field.key] ?? '' })));
  protected readonly letterPage = signal(1);
  protected readonly letterPageSize = signal(10);
  protected readonly letterPageCount = computed(() => Math.max(1, Math.ceil(this.myLetters().length / this.letterPageSize())));
  protected readonly pagedLetters = computed(() => this.myLetters().slice((this.letterPage() - 1) * this.letterPageSize(), this.letterPage() * this.letterPageSize()));
  protected readonly letterPageStart = computed(() => this.myLetters().length === 0 ? 0 : (this.letterPage() - 1) * this.letterPageSize() + 1);
  protected readonly letterPageEnd = computed(() => Math.min(this.letterPage() * this.letterPageSize(), this.myLetters().length));
  protected readonly employeeForm = this.formBuilder.nonNullable.group({
    personalEmail: [''], phoneNumber: [''], bloodGroup: [''], maritalStatus: [''], emergencyContact1: [''], emergencyContact2: [''],
    currentAddress: [''], currentPincode: [''], currentCountry: [''], currentCity: [''], sameAddress: [false], permanentAddress: [''], permanentPincode: [''], permanentCountry: [''], permanentCity: [''],
    previousEmployee: [false], organization: [''], previousDesignation: [''], department: [''], lastCtc: [''], joiningDate: [''], lwd: [''], previousSkillName: [''], relievingLetter: [''], experienceCertificate: [''],
    degree: [''], higherQualification: [''], universityName: [''], passedOutYear: [''], aadhaarNumber: [''], aadhaarPhoto: [''], panNumber: [''], panPhoto: [''], passportNumber: [''], passportPhoto: [''], resume: [''], resignationLetter: [''], profilePhoto: [''], bankIfsc: [''], cancelledCheque: [''],
  });
  protected readonly resignationForm = this.formBuilder.nonNullable.group({ appliedDate: [this.localDateString(new Date()), Validators.required], reason: ['', Validators.required], comments: [''] });
  protected readonly resignationEditingId = signal<string | null>(null);
  protected readonly resignationNoticePeriod = 15;
  protected readonly tentativeRelievingDate = computed(() => this.addDays(this.resignationForm.controls.appliedDate.value, this.resignationNoticePeriod));
  protected readonly resetEmailForm = this.formBuilder.nonNullable.group({ email: ['', [Validators.required, Validators.email]] });
  protected readonly resetPasswordForm = this.formBuilder.nonNullable.group({ password: ['', [Validators.required, Validators.minLength(6)]], confirmPassword: ['', Validators.required], otp: ['', Validators.required] }, { validators: group => group.get('password')?.value === group.get('confirmPassword')?.value ? null : { passwordMismatch: true } });
  protected readonly resetToken = signal('');
  protected readonly resetOtpStep = signal(false);
  protected readonly attendance = signal<AttendanceRecord[]>([]);
  protected readonly calendarAttendance = signal<AttendanceRecord[]>([]);
  protected readonly calendarMonth = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  protected readonly calendarTitle = computed(() => new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(this.calendarMonth()));
  protected readonly calendarCells = computed((): (AttendanceCalendarDay | null)[] => {
    const month = this.calendarMonth();
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    const prefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}-`;
    const records = new Map(this.calendarAttendance().filter((record) => record.employeeId === this.currentEmployee().employeeId && record.workDate.startsWith(prefix)).map((record) => [record.workDate, record]));
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
      if (record?.status === 'LOP') { status = 'lop'; label = 'Full day LOP · missing check-in or check-out'; }
      else if (record && (!this.hasPunch(record.checkIn) || !this.hasPunch(record.checkOut))
        && isoDate < today && weekday !== 0 && weekday !== 6 && !holidayName && !approvedLeave) {
        status = 'lop';
        label = 'Full day LOP · missing check-in or check-out';
      }
      else if (record?.status === 'Present') { status = 'present'; label = 'Present'; }
      else if (record?.status === 'Late') { status = 'exception'; label = 'Exception'; }
      else if (record?.status === 'Half day leave') { status = 'half-day-leave'; label = 'Half day leave'; }
      else if (record?.status === 'On leave') { status = 'full-day-leave'; label = 'Full day leave'; }
      else if (holidayName) { status = 'holiday'; label = holidayName; }
      else if (approvedLeave && weekday !== 0 && weekday !== 6) { status = 'full-day-leave'; label = 'Full day leave'; }
      else if (weekday === 0 || weekday === 6) { status = 'week-off'; label = 'Week off'; }
      else if (isoDate < today) { status = 'lop'; label = 'Full day LOP · no attendance recorded'; }
      cells.push({ day, isoDate, status, label, holidayName, today: isoDate === today });
    }
    return cells;
  });
  protected readonly leaveRequests = signal<LeaveRequest[]>([]);
  protected readonly publicHolidays = signal<PublicHoliday[]>([]);
  protected readonly upcomingHolidays = computed(() => {
    const today = this.localDateString(new Date());
    return this.publicHolidays().filter((holiday) => holiday.date.startsWith(`${this.holidayYear}-`) && holiday.date >= today).slice(0, 5);
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
  protected readonly holidayYear = new Date().getFullYear();
  protected readonly holidayRows = computed(() => {
    const today = this.localDateString(new Date());
    return this.publicHolidays()
      .filter((holiday) => holiday.date.startsWith(`${this.holidayYear}-`))
      .filter((holiday) => this.holidayFilter() === 'all' || holiday.date >= today)
      .sort((left, right) => left.date.localeCompare(right.date));
  });
  protected readonly upcomingHolidayCount = computed(() => {
    const today = this.localDateString(new Date());
    return this.publicHolidays().filter((holiday) => holiday.date.startsWith(`${this.holidayYear}-`) && holiday.date >= today).length;
  });
  protected readonly presentCount = computed(() => this.attendance().filter((entry) => entry.status === 'Present').length);
  protected readonly pendingLeaveCount = computed(() => this.leaveRequests().filter((request) => request.employeeId === this.currentEmployee().employeeId && request.status === 'Pending').length);
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
    requestType: ['Leave', Validators.required],
    type: ['Personal leave', Validators.required],
    startDate: ['', Validators.required],
    endDate: ['', Validators.required],
    fromSession: ['First half', Validators.required],
    toSession: ['Second half', Validators.required],
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
    { key: 'overview', label: 'Dashboard', icon: '◫' },
    { key: 'attendance', label: 'Attendance', icon: '◷' },
    { key: 'leave', label: 'Leave requests', icon: '▤' },
    { key: 'resignation', label: 'Employee resignation', icon: '↗' },
    { key: 'letters', label: 'Letters', icon: '▧' },
    { key: 'holidays', label: 'Public holidays', icon: '☼' },
    { key: 'profile', label: 'My profile', icon: '◎' },
  ];

  protected setAuthMode(mode: AuthMode): void {
    this.authMode.set(mode);
    this.notice.set('');
  }

  protected updateLeaveRequestType(): void {
    if (this.leaveForm.controls.requestType.value === 'WorkFromHome') this.leaveForm.controls.type.setValue('WorkFromHome');
    else this.leaveForm.controls.type.setValue('Personal leave');
  }

  protected changeAttendanceMonth(offset: number): void {
    const month = this.attendanceMonth();
    const next = new Date(month.getFullYear(), month.getMonth() + offset, 1);
    this.attendanceMonth.set(next);
    void this.loadCalendarAttendance(next);
  }

  protected async resetCheckIn(): Promise<void> {
    const id = this.currentEmployee().employeeId;
    await this.performApi(this.api.resetTodayAttendance(id), () => {
      this.attendance.update(items => items.filter(item => item.employeeId !== id));
      this.calendarAttendance.update(items => items.filter(item => !(item.employeeId === id && item.workDate === this.localDateString(new Date()))));
    }, 'Could not reset today\'s attendance.');
  }

  protected downloadLetter(field: ProfileFileKey): void {
    const data = this.profileFileData()[field];
    const name = this.selectedProfileFiles()[field];
    if (!data || !name) { this.notice.set('This letter has not been uploaded to your profile yet.'); return; }
    const link = document.createElement('a');
    link.href = data;
    link.download = name;
    link.click();
  }

  protected saveResignation(): void {
    if (this.resignationForm.invalid) { this.resignationForm.markAllAsTouched(); return; }
    const form = this.resignationForm.getRawValue();
    const entry = { id: this.resignationEditingId() ?? crypto.randomUUID(), employeeName: this.fullName(), appliedDate: form.appliedDate, noticePeriod: this.resignationNoticePeriod, tentativeDate: this.tentativeRelievingDate(), actualDate: this.tentativeRelievingDate(), approver: 'Manager not assigned', reason: form.reason, comments: form.comments };
    const rows = this.resignationEditingId() ? this.resignations().map(row => row.id === entry.id ? entry : row) : [entry, ...this.resignations()];
    this.resignations.set(rows);
    localStorage.setItem(`resignations:${this.currentEmployee().employeeId}`, JSON.stringify(rows));
    this.resignationEditingId.set(null);
    this.resignationForm.reset({ appliedDate: this.localDateString(new Date()), reason: '', comments: '' });
    this.notice.set('Resignation request saved.');
  }

  protected editResignation(item: ResignationRow): void {
    this.resignationEditingId.set(item.id);
    this.resignationForm.reset({ appliedDate: item.appliedDate, reason: item.reason, comments: item.comments });
  }

  protected deleteResignation(id: string): void {
    const rows = this.resignations().filter(item => item.id !== id);
    this.resignations.set(rows);
    localStorage.setItem(`resignations:${this.currentEmployee().employeeId}`, JSON.stringify(rows));
  }

  protected async requestPasswordReset(): Promise<void> {
    if (this.resetEmailForm.invalid) { this.resetEmailForm.markAllAsTouched(); return; }
    try {
      await firstValueFrom(this.api.requestPasswordReset(this.resetEmailForm.controls.email.value));
      this.notice.set('If this email belongs to an account, a password reset link has been sent.');
    } catch (error) { this.notice.set(this.apiErrorMessage(error) ?? 'Could not send the reset email. Check the employee service mail settings.'); }
  }

  protected async submitPasswordReset(): Promise<void> {
    if (!this.resetOtpStep()) {
      if (this.resetPasswordForm.controls.password.invalid || this.resetPasswordForm.hasError('passwordMismatch')) { this.resetPasswordForm.markAllAsTouched(); return; }
      try {
        await firstValueFrom(this.api.resetPassword({ token: this.resetToken(), email: this.resetEmailForm.controls.email.value, password: this.resetPasswordForm.controls.password.value }));
        this.resetOtpStep.set(true);
        this.notice.set('A verification code was sent to your registered email. Enter it to finish resetting your password.');
      } catch (error) { this.notice.set(this.apiErrorMessage(error) ?? 'The reset link is invalid or expired.'); }
      return;
    }
    if (this.resetPasswordForm.controls.otp.invalid) { this.resetPasswordForm.controls.otp.markAsTouched(); return; }
    try {
      await firstValueFrom(this.api.verifyPasswordResetOtp({ email: this.resetEmailForm.controls.email.value, otp: this.resetPasswordForm.controls.otp.value }));
      this.setAuthMode('login');
      this.loginForm.reset();
      this.notice.set('Password reset verified. Sign in with your new password.');
      this.resetOtpStep.set(false);
      this.resetToken.set('');
    } catch (error) { this.notice.set(this.apiErrorMessage(error) ?? 'The one-time code is invalid or expired.'); }
  }

  protected saveEmployeeProfile(): void {
    const id = this.currentEmployee().employeeId;
    localStorage.setItem(`employee-profile:${id}`, JSON.stringify({ ...this.employeeForm.getRawValue(), skills: this.profileSkills(), files: this.profileFileData(), uploadedAt: this.profileFileDates() }));
    this.notice.set('Employee profile saved.');
  }

  protected setProfileFile(field: 'relievingLetter' | 'experienceCertificate' | 'aadhaarPhoto' | 'panPhoto' | 'passportPhoto' | 'resume' | 'resignationLetter' | 'profilePhoto' | 'cancelledCheque', event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { this.notice.set('Choose a document no larger than 2 MB.'); input.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      this.employeeForm.controls[field].setValue(file.name);
      this.selectedProfileFiles.update(files => ({ ...files, [field]: file.name }));
      this.profileFileData.update(files => ({ ...files, [field]: reader.result as string }));
      this.profileFileDates.update(dates => ({ ...dates, [field]: this.localDateString(new Date()) }));
    };
    reader.readAsDataURL(file);
  }

  protected toggleSameAddress(): void {
    if (!this.employeeForm.controls.sameAddress.value) return;
    const current = this.employeeForm.getRawValue();
    this.employeeForm.patchValue({ permanentAddress: current.currentAddress, permanentPincode: current.currentPincode, permanentCountry: current.currentCountry, permanentCity: current.currentCity });
  }

  protected addProfileSkill(): void { this.profileSkills.update(rows => [...rows, { name: '', type: '', level: '' }]); }
  protected updateProfileSkill(index: number, field: keyof ProfileSkillRow, value: string): void { this.profileSkills.update(rows => rows.map((row, i) => i === index ? { ...row, [field]: value } : row)); }
  protected removeProfileSkill(index: number): void { this.profileSkills.update(rows => rows.filter((_, i) => i !== index)); }

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
    if (this.activeSection() !== section) {
      history.pushState({ ...(history.state ?? {}), peopleSection: section }, '', location.pathname);
    }
    this.activeSection.set(section);
    sessionStorage.setItem('people-section', section);
    this.mobileMenuOpen.set(false);
    this.notice.set('');
  }

  protected setEmployeeSearch(value: string): void {
    this.employeeSearch.set(value);
    this.employeePage.set(1);
  }

  protected setEmployeePage(page: number): void {
    this.employeePage.set(Math.max(1, Math.min(page, this.employeePageCount())));
  }

  protected restoreSectionFromHistory(event: PopStateEvent): void {
    if (!this.isAuthenticated()) return;
    const section = event.state?.peopleSection;
    const nextSection = this.navigation.some((item) => item.key === section) ? section as SectionKey : 'overview';
    this.activeSection.set(nextSection);
    sessionStorage.setItem('people-section', nextSection);
    this.mobileMenuOpen.set(false);
    this.notice.set('');
  }

  protected shiftCalendarMonth(offset: number): void {
    const month = this.calendarMonth();
    const nextMonth = new Date(month.getFullYear(), month.getMonth() + offset, 1);
    this.calendarMonth.set(nextMonth);
    void this.loadCalendarAttendance(nextMonth);
  }

  protected setLetterPage(page: number): void {
    this.letterPage.set(Math.max(1, Math.min(page, this.letterPageCount())));
  }

  protected setLetterPageSize(value: string): void {
    const pageSize = Number(value);
    if (!Number.isInteger(pageSize) || pageSize < 1) return;
    this.letterPageSize.set(pageSize);
    this.letterPage.set(1);
  }

  protected goToLetterPage(value: string): void {
    const page = Number(value);
    if (Number.isInteger(page)) this.setLetterPage(page);
  }

  protected formatLetterDate(isoDate: string): string {
    const [year, month, day] = isoDate.split('-').map(Number);
    if (!year || !month || !day) return '—';
    return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(year, month - 1, day));
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
    const form = this.leaveForm.getRawValue();
    const payload = { employeeId: this.currentEmployee().employeeId, type: form.requestType === 'WorkFromHome' ? 'WorkFromHome' : form.type, requestType: form.requestType as 'WorkFromHome' | 'Leave', leaveType: form.requestType === 'Leave' ? form.type as 'Personal leave' | 'Sick leave' : null, fromSession: form.fromSession as 'First half' | 'Second half', toSession: form.toSession as 'First half' | 'Second half', startDate: form.startDate, endDate: form.endDate, reason: form.reason };
    const saved = this.editingLeaveId()
      ? await this.performApi(this.api.editLeaveRequest(this.editingLeaveId()!, payload), request => this.leaveRequests.update(items => items.map(item => item.id === request.id ? request : item)), 'Could not update leave request.')
      : await this.performApi(this.api.createLeaveRequest(payload), request => this.leaveRequests.update(items => [request, ...items]), 'Could not save leave request.');
    if (saved) {
      this.leaveDialogOpen.set(false);
      this.editingLeaveId.set(null);
      this.leaveForm.reset({ requestType: 'Leave', type: 'Personal leave', startDate: '', endDate: '', fromSession: 'First half', toSession: 'Second half', reason: '' });
    }
  }

  protected editLeave(request: LeaveRequest): void {
    this.leaveForm.reset({ requestType: request.requestType ?? (request.type === 'WorkFromHome' ? 'WorkFromHome' : 'Leave'), type: request.leaveType ?? 'Personal leave', startDate: request.startDate, endDate: request.endDate, fromSession: request.fromSession ?? 'First half', toSession: request.toSession ?? 'Second half', reason: request.reason ?? '' });
    this.editingLeaveId.set(request.id);
    this.leaveDialogOpen.set(true);
  }

  protected openNewLeave(): void {
    this.editingLeaveId.set(null);
    this.leaveForm.reset({ requestType: 'Leave', type: 'Personal leave', startDate: '', endDate: '', fromSession: 'First half', toSession: 'Second half', reason: '' });
    this.leaveDialogOpen.set(true);
  }

  protected closeLeaveDialog(): void {
    this.leaveDialogOpen.set(false);
    this.editingLeaveId.set(null);
  }

  protected async deleteLeave(request: LeaveRequest): Promise<void> {
    await this.performApi(this.api.deleteLeaveRequest(request.id, this.currentEmployee().employeeId), () => {
      this.leaveRequests.update(items => items.filter(item => item.id !== request.id));
    }, 'Could not delete leave request.');
  }

  protected readonly editingLeaveId = signal<string | null>(null);

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
    if (!payload.date.startsWith(`${this.holidayYear}-`)) {
      this.notice.set(`Choose a date in ${this.holidayYear}.`);
      return;
    }
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

  protected signOut(): void {
    sessionStorage.removeItem('people-employee');
    sessionStorage.removeItem('people-section');
    this.isAuthenticated.set(false);
    this.authMode.set('login');
    this.currentEmployee.set(EMPTY_EMPLOYEE);
    this.employees.set([]);
    this.attendance.set([]);
    this.calendarAttendance.set([]);
    this.leaveRequests.set([]);
    this.publicHolidays.set([]);
    this.employeeProfile.set(null);
    this.employeeSearch.set('');
    this.employeePage.set(1);
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

  private hasPunch(value: string): boolean {
    return !!value && value !== '—';
  }

  private enterDashboard(employee: Employee): void {
    this.employeeForm.reset();
    this.profileSkills.set([]);
    this.profileFileData.set({});
    this.selectedProfileFiles.set({});
    this.profileFileDates.set({});
    this.currentEmployee.set(employee);
    this.isAuthenticated.set(true);
    this.activeSection.set('overview');
    sessionStorage.setItem('people-section', 'overview');
    sessionStorage.setItem('people-employee', JSON.stringify(employee));
    history.replaceState({ ...(history.state ?? {}), peopleSection: 'overview' }, '', location.pathname);
    try { this.resignations.set(JSON.parse(localStorage.getItem(`resignations:${employee.employeeId}`) ?? '[]')); } catch { this.resignations.set([]); }
    try {
      const saved = JSON.parse(localStorage.getItem(`employee-profile:${employee.employeeId}`) ?? '{}') as Record<string, unknown>;
      const { skills, files, uploadedAt, relievingLetter, experienceCertificate, aadhaarPhoto, panPhoto, passportPhoto, resume, resignationLetter, profilePhoto, cancelledCheque, ...fields } = saved;
      this.employeeForm.patchValue(fields as Partial<typeof this.employeeForm.value>);
      const fileNames: Record<string, string> = {};
      for (const key of ['relievingLetter', 'experienceCertificate', 'aadhaarPhoto', 'panPhoto', 'passportPhoto', 'resume', 'resignationLetter', 'profilePhoto', 'cancelledCheque']) {
        const value = saved[key];
        if (typeof value === 'string') fileNames[key] = value;
      }
      this.selectedProfileFiles.set(fileNames);
      this.profileFileData.set(files && typeof files === 'object' ? files as Record<string, string> : {});
      this.profileFileDates.set(uploadedAt && typeof uploadedAt === 'object' ? uploadedAt as Record<string, string> : {});
      this.profileSkills.set(Array.isArray(skills) ? skills as ProfileSkillRow[] : []);
    } catch { this.profileSkills.set([]); }
    void this.loadRemoteData();
  }

  constructor() {
    const query = new URLSearchParams(location.search);
    const token = query.get('resetToken');
    const email = query.get('email');
    if (token) {
      this.resetToken.set(token);
      this.authMode.set('reset');
      if (email) this.resetEmailForm.controls.email.setValue(email);
      history.replaceState({ ...(history.state ?? {}), passwordReset: true }, '', location.pathname);
    }
    if (!token) {
      try {
        const saved = sessionStorage.getItem('people-employee');
        if (saved) {
          const savedSection = sessionStorage.getItem('people-section') as SectionKey | null;
          this.enterDashboard(JSON.parse(saved) as Employee);
          if (savedSection && this.navigation.some(item => item.key === savedSection)) {
            this.activeSection.set(savedSection);
            sessionStorage.setItem('people-section', savedSection);
            history.replaceState({ ...(history.state ?? {}), peopleSection: savedSection }, '', location.pathname);
          }
        }
      } catch { sessionStorage.removeItem('people-employee'); }
    }
  }

  private async loadRemoteData(): Promise<void> {
    try {
      const employeeId = this.currentEmployee().employeeId;
      const month = this.calendarMonth();
      const [employees, attendance, monthAttendance, leaveRequests, publicHolidays, employeeProfile] = await Promise.all([
        firstValueFrom(this.api.getEmployees()),
        firstValueFrom(this.api.getAttendance(employeeId)),
        firstValueFrom(this.api.getAttendanceMonth(employeeId, month.getFullYear(), month.getMonth() + 1)),
        firstValueFrom(this.api.getLeaveRequests(employeeId)),
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

  private countMonthWorkingDays(month: Date): number {
    let count = 0;
    for (let day = 1; day <= new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(); day++) {
      const date = new Date(month.getFullYear(), month.getMonth(), day);
      const isoDate = this.localDateString(date);
      const isHoliday = this.publicHolidays().some(holiday => holiday.date === isoDate);
      if (date.getDay() !== 0 && date.getDay() !== 6 && !isHoliday) count++;
    }
    return count;
  }

  private addDays(isoDate: string, days: number): string {
    if (!isoDate) return '';
    const date = new Date(`${isoDate}T00:00:00`);
    date.setDate(date.getDate() + days);
    return this.localDateString(date);
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
