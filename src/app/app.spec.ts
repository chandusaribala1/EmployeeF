import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    })
      .compileComponents();
  });

  it('renders the employee sign-in view', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h2')?.textContent).toContain('Welcome back');
    expect(compiled.querySelector('#login-employee-id')).toBeTruthy();
    expect(compiled.querySelector('#login-password')).toBeTruthy();
  });

  it('opens the dashboard from the demo entry and switches sections', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    const demoButton = Array.from(compiled.querySelectorAll('button')).find((button) => button.textContent?.includes('Explore the demo workspace'));
    demoButton?.click();
    fixture.detectChanges();
    expect(compiled.querySelector('h1')?.textContent).toContain('Your day at a glance');
    const checkoutButton = Array.from(compiled.querySelectorAll<HTMLButtonElement>('.attendance-actions button')).find((button) => button.textContent?.includes('Check out'));
    expect(checkoutButton?.disabled).toBe(false);

    const attendanceButton = Array.from(compiled.querySelectorAll<HTMLButtonElement>('.nav-item')).find((button) => button.textContent?.includes('Attendance'));
    attendanceButton?.click();
    fixture.detectChanges();
    expect(compiled.querySelector('h1')?.textContent).toContain('Attendance');
  });

  it('does not open a session when the API rejects login credentials', async () => {
    const fixture = TestBed.createComponent(App);
    const httpTesting = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    (compiled.querySelector('#login-employee-id') as HTMLInputElement).value = 'EMP-1001';
    compiled.querySelector('#login-employee-id')?.dispatchEvent(new Event('input'));
    (compiled.querySelector('#login-password') as HTMLInputElement).value = 'incorrect-password';
    compiled.querySelector('#login-password')?.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    compiled.querySelector('form')?.dispatchEvent(new Event('submit'));
    const request = httpTesting.expectOne('/api/auth/login');
    request.flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(compiled.querySelector('h2')?.textContent).toContain('Welcome back');
    expect(compiled.querySelector('[role="status"]')?.textContent).toContain('was not accepted');
    httpTesting.verify();
  });
});
