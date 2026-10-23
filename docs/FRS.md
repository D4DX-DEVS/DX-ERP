**D4DX INTERNAL ERP SYSTEM**

**Functional Requirements Specification (FRS)**

**Organization:** D4DX Innovations LLP\
**Website:** <https://d4dx.co/>\
**Document Type:** Functional Requirements Specification

**1. Project Overview**

D4DX Innovations LLP requires a centralized **Enterprise Resource
Planning (ERP)** system to manage its employees, interns, clients,
projects, attendance, office movements, HR processes, and commercial
operations.

The system shall provide a unified platform for managing the complete
operational lifecycle of the organization, from employee onboarding and
client acquisition to project delivery, invoicing, and payment tracking.

The ERP shall be developed as a secure, scalable, web-based application
with a responsive interface accessible through desktop, tablet, and
mobile devices.

**1.1 Project Objectives**

The ERP system shall:

1.  Centralize employee, trainee, intern, and client information.

2.  Manage attendance, working hours, leave, and payroll.

3.  Record office movements with Out-Time, In-Time, purpose, and
    duration.

4.  Manage projects, tasks, milestones, deadlines, and resource
    allocation.

5.  Track internship assignments, training activities, and performance
    reviews.

6.  Manage client enquiries, proposals, quotations, contracts, and
    follow-ups.

7.  Track invoices, payments, expenses, and project-related financial
    information.

8.  Automate approvals, notifications, reminders, and recurring
    activities.

9.  Generate operational and management reports.

10. Maintain accountability through role-based permissions and audit
    trails.

**2. System Scope**

The ERP shall include the following modules:

1.  User Authentication and Access Control.

2.  Dashboard and Management Overview.

3.  Staff and HR Management.

4.  Intern and Trainee Management.

5.  Attendance and Working Hours.

6.  Movement Register and Time Management.

7.  Leave Management.

8.  Payroll, Stipends, and Allowances.

9.  Project and Task Management.

10. Timesheet Management.

11. Quality Assurance and Issue Tracking.

12. Client Relationship Management (CRM).

13. Proposals, Quotations, and Contracts.

14. Finance and Accounts.

15. Asset and Inventory Management.

16. Notifications and Reminders.

17. Reports and Analytics.

18. System Administration and Configuration.

**3. User Roles and Permissions**

The system shall implement Role-Based Access Control (RBAC). Users shall
only access the information and actions authorized for their roles.

**3.1 User Roles**

  -----------------------------------------------------------------------
  **Role**       **Primary Responsibilities**
  -------------- --------------------------------------------------------
  Super Admin    Complete system configuration, user management, and
                 access control

  Management     Organization-wide oversight, approvals, dashboards, and
                 reports

  HR / Admin     Employee and intern records, attendance, movement
                 register, leave, and HR administration

  Finance /      Payroll, stipends, invoices, payments, expenses, and
  Accounts       financial reports

  Business       Leads, enquiries, proposals, quotations, and client
  Development    follow-ups

  Project        Project planning, resource allocation, task assignments,
  Manager        milestones, and delivery

  Team Lead      Team coordination, task monitoring, timesheet review,
                 and assigned approvals

  Employee       Own profile, attendance, movement records, leave
                 requests, assigned tasks, and timesheets

  Trainee        Assigned tasks, attendance, training activities, and
                 permitted project information

  Intern         Internship records, attendance, movement records,
                 assigned tasks, learning activities, work submissions,
                 and performance feedback
  -----------------------------------------------------------------------

**3.2 Permission Controls**

The system shall support configurable permissions for:

- View and search.

- Create and edit.

- Delete, where authorized.

- Approve and reject.

- Assign and reassign tasks.

- Generate and export reports.

- Access confidential information.

- Manage users and configuration.

Interns and trainees shall only access information required for their
assigned responsibilities. Salary details, payroll, financial reports,
confidential employee records, restricted client information, and
administrative settings shall remain inaccessible unless explicitly
authorized.

**4. Dashboard and Management Overview**

The system shall provide role-specific dashboards.

**4.1 Management Dashboard**

The dashboard shall display:

- Total employees, trainees, and interns.

- Present, absent, and on-leave staff.

- Employees currently outside the office, based on recorded movements.

- Active movements with missing In-Time.

- Overdue movements and pending approvals.

- Active, completed, delayed, and upcoming projects.

- Active clients and pending enquiries.

- Revenue, outstanding invoices, and expenses.

- Pending approvals and overdue tasks.

- Monthly and annual operational summaries.

**4.2 Employee Dashboard**

The employee dashboard shall display:

- Today\'s attendance status.

- Check-in and check-out times.

- Working-hour summary.

- Current movement status, if applicable.

- Personal movement history.

- Leave balance and request status.

- Assigned tasks and deadlines.

- Timesheets and submission status.

- Announcements and notifications.

**4.3 Intern Dashboard**

The intern dashboard shall display:

- Attendance and working-hour summary.

- Assigned projects and tasks.

- Task deadlines and submission status.

- Approved training materials and learning activities.

- Supervisor or mentor details.

- Feedback and performance review status.

- Internship start date and expected completion date.

- Personal movement history, subject to policy.

**4.4 Project Dashboard**

The project dashboard shall display:

- Project progress and milestones.

- Task status and overdue tasks.

- Assigned team members and workload.

- Estimated versus actual effort.

- Open QA issues and defects.

- Project budget and billing summary, subject to permissions.

**5. Staff and HR Management**

**5.1 Employee Records**

The system shall allow authorized users to create, view, and maintain
employee records.

Each record shall include:

- Unique employee ID.

- Full name and profile photo.

- Contact details and address.

- Designation and department.

- Employment type and joining date.

- Employment status.

- Reporting manager and assigned team.

- Salary and allowance details, subject to permissions.

- Emergency contact.

- Employment documents and agreements.

The system shall support configurable employment statuses, including
Active, On Leave, Resigned, Terminated, and Inactive.

**5.2 Employee Lifecycle Management**

The system shall support:

- Employee onboarding.

- Department and designation assignment.

- Reporting manager assignment.

- Document collection.

- Promotions and designation changes.

- Salary revisions.

- Notice-period tracking.

- Resignation and exit processing.

- Employment history maintenance.

**5.3 Employee Documents**

Authorized users shall be able to:

- Upload and categorize documents.

- Record document expiry dates.

- Track missing documents.

- Restrict access to confidential files.

- Maintain document history.

**6. Intern and Trainee Management**

**6.1 Internship Records**

Each intern record shall include:

- Intern ID.

- Name and contact information.

- Internship start and end dates.

- Department and assigned role.

- Supervisor or mentor.

- Internship objectives.

- Relevant documents.

- Internship status.

**6.2 Internship Workflow**

The system shall support:

1.  Intern registration.

2.  Supervisor assignment.

3.  Internship objective setting.

4.  Training and task allocation.

5.  Attendance and movement tracking.

6.  Work submission and review.

7.  Progress evaluations.

8.  Feedback and improvement tracking.

9.  Internship completion.

10. Certificate generation, where approved.

**6.3 Intern Permissions**

Interns shall be able to:

- View their own profile.

- Record attendance and office movements.

- Submit leave requests under the applicable policy.

- View assigned projects and tasks.

- Update task progress.

- Submit completed work for review.

- Record timesheets when required.

- Access approved training materials.

- View authorized feedback and progress evaluations.

Interns shall not access restricted client records, payroll, financial
information, other employees\' confidential data, or administrative
functions without explicit authorization.

**7. Attendance and Working Hours**

**7.1 Attendance Features**

The system shall support:

- Check-in and check-out.

- Automatic timestamp recording.

- Working-hour calculation.

- Break-duration tracking.

- Late arrival and early departure indicators.

- Full-day and half-day attendance classification.

- Missing check-out alerts.

- Attendance correction requests.

- Authorized manual attendance entry.

- Attendance approval history.

**7.2 Attendance Rules**

- Working days, office hours, holidays, and grace periods shall be
  configurable.

- Attendance calculations shall follow approved company policies.

- Working hours shall be calculated automatically.

- Attendance corrections shall require a reason.

- Changes shall be recorded in the audit trail.

- Employees and interns shall view their own attendance records unless
  additional access is granted.

**7.3 Attendance Reports**

The system shall generate:

- Daily attendance reports.

- Monthly attendance summaries.

- Employee-wise and intern-wise reports.

- Late arrival and early departure reports.

- Missing attendance reports.

- Working-hour summaries.

- Attendance correction history.

**8. Movement Register and Time Management**

**8.1 Purpose**

The ERP shall include a Movement Register to record and monitor
employees\' movements in and out of the office during working hours.

The module shall record departure and return times, movement purpose,
destination, expected return time, actual duration outside the office,
and approval status.

It shall support employees, trainees, and interns according to company
policy.

**8.2 Movement Register Entry**

Each movement record shall include:

- Movement ID --- automatically generated.

- Employee or intern ID and name.

- Movement date.

- Out-Time.

- Purpose of movement.

- Destination, where applicable.

- Expected return time.

- In-Time.

- Total duration outside the office.

- Movement category.

- Project or client reference, where applicable.

- Remarks.

- Approval status.

- Created and modified timestamps.

The user\'s identity and movement date should be populated automatically
wherever possible.

**8.3 Movement Categories**

The system shall support configurable categories such as:

- Client meeting.

- Official business.

- Project-related work.

- Personal work.

- Medical or emergency reasons.

- Other authorized purposes.

Management shall be able to define which categories require approval.

**8.4 Movement Recording Workflow**

1.  The employee initiates a movement entry before leaving the office.

2.  The system records the Out-Time when the departure is confirmed.

3.  The employee selects the purpose and provides relevant details.

4.  The expected return time is recorded where required.

5.  On returning, the employee records the In-Time.

6.  The system calculates the total duration outside the office.

7.  If approval is required, the record is sent to the designated
    approver.

8.  The movement record is updated and included in relevant reports.

The system shall support an authorized alternative entry method where an
employee cannot record a movement at the time of departure or return.
Such entries must be marked accordingly and maintain an audit trail.

**8.5 Time Calculation**

The system shall calculate the total time outside the office using the
recorded departure and return timestamps.

**Formula:**

Total Time Outside = In-Time − Out-Time

The calculation shall use full date-time values to handle movements that
cross midnight correctly.

The system shall:

- Calculate the duration automatically.

- Support multiple movements by the same person in a single day.

- Calculate daily total movement duration.

- Flag movements exceeding expected return times.

- Identify missing In-Time records.

- Distinguish official and personal movements.

- Display active movements that have not yet been closed.

An active movement with no In-Time shall not be assigned a final
duration until the return time is recorded or the record is resolved by
an authorized user.

**8.6 Movement Statuses**

The system shall support the following statuses:

- Draft, where applicable.

- Out --- employee is recorded as outside the office.

- Returned --- In-Time has been recorded.

- Pending Approval.

- Approved.

- Rejected.

- Correction Requested.

- Cancelled, where permitted.

The system shall distinguish movement status from approval status where
necessary.

**8.7 Movement Register Dashboard**

Authorized users shall be able to view:

- Employees currently outside the office.

- Employees who have returned.

- Active movements without In-Time.

- Movements exceeding expected return time.

- Pending movement approvals.

- Daily movement counts.

- Total time spent outside the office.

- Official and personal movement summaries, subject to permissions.

**8.8 Movement Corrections**

- Employees may request corrections to movement records.

- Corrections shall require a reason.

- Managers or HR/Admin may approve corrections according to policy.

- Original timestamps shall be preserved.

- Modified values, user identity, timestamp, and reason shall be logged.

- Approved records shall not be altered without authorization.

**8.9 Movement Register Reports**

The system shall generate:

- Daily Movement Register.

- Employee-wise movement history.

- In-Time and Out-Time report.

- Duration-outside-office report.

- Late-return and overdue-movement report.

- Official movement report.

- Personal movement report with restricted access.

- Pending and rejected movement report.

- Correction and approval audit report.

Reports shall support filters for employee, department, date range,
movement category, and approval status. Authorized users shall be able
to export reports to Excel, CSV, or PDF.

**8.10 Movement Notifications**

The system shall notify relevant users about:

- Movement submission.

- Approval or rejection.

- Expected return time exceeded.

- Missing In-Time.

- Pending approval.

- Correction requests.

**8.11 Integration with Attendance**

The Movement Register shall integrate with the Attendance module.

- Office attendance check-in/check-out shall remain separate from
  movement Out-Time/In-Time.

- Temporary departure shall not automatically be treated as the end of
  the working day.

- Movement records shall be visible alongside daily attendance to
  authorized users.

- Official movements shall be categorized separately from personal
  movements.

- Any impact on working hours or attendance classification shall follow
  approved company policy.

- Inconsistent or missing records shall be flagged for review.

**9. Leave Management**

**9.1 Leave Types**

The system shall support configurable leave categories:

- Casual leave.

- Sick leave.

- Annual leave.

- Unpaid leave.

- Compensatory leave.

- Other company-defined leave types.

**9.2 Leave Workflow**

1.  The employee or intern submits a leave request.

2.  The reporting manager or supervisor reviews the request.

3.  HR/Admin or management provides additional approval if required.

4.  The system updates leave balances and attendance records according
    to policy.

5.  The applicant receives a notification.

**9.3 Leave Requirements**

The system shall support:

- Leave balance display.

- Full-day and half-day requests.

- Overlapping leave detection.

- Configurable leave limits and accrual.

- Carry-forward rules, where applicable.

- Leave history and approval records.

- Team leave calendars.

- Leave reports by employee and date range.

**10. Payroll, Stipends, and Allowances**

**10.1 Payroll Components**

The system shall support:

- Basic salary.

- Allowances, where applicable.

- Incentives and bonuses.

- Overtime, where applicable.

- Deductions and unpaid leave adjustments.

- Reimbursements.

- Other configured earnings and deductions.

- Net payable amount.

**10.2 Intern and Trainee Stipends**

The system shall support:

- Stipend amount and payment period.

- Stipend eligibility.

- Payment records and history.

- Authorized stipend reports.

**10.3 Payroll Workflow**

1.  HR/Admin verifies attendance, leave, and employment details.

2.  Finance prepares payroll or stipend calculations.

3.  The system calculates earnings and deductions using configured
    rules.

4.  Authorized management reviews and approves the statement.

5.  Finance records payment details.

6.  Payslips or stipend statements are generated.

**10.4 Payroll Requirements**

- Support monthly payroll periods.

- Maintain salary and stipend revision history.

- Record advances and reimbursements.

- Generate employee-wise and period-wise reports.

- Restrict salary information to authorized users.

- Support accounting and payment exports.

Statutory deductions and compliance rules must be reviewed and
configured before production use.

**11. Project and Task Management**

**11.1 Project Creation**

Each project shall include:

- Project ID and title.

- Client.

- Description and scope.

- Deliverables.

- Project manager and team.

- Start date and target completion date.

- Estimated budget and effort.

- Priority and status.

- Proposal or contract reference.

- Milestones and delivery dates.

**11.2 Project Statuses**

Suggested statuses:

- Enquiry.

- Planning.

- In Progress.

- On Hold.

- Under Review.

- Completed.

- Cancelled.

Statuses shall be configurable.

**11.3 Task Management**

The system shall support:

- Task and subtask creation.

- Assignment to employees, trainees, and interns.

- Priority and deadline setting.

- Effort estimates.

- Descriptions and attachments.

- Comments and progress updates.

- Task dependencies and blockers.

- Deadline notifications.

- Task history and status tracking.

**11.4 Intern Task Controls**

- Interns shall view only assigned or explicitly shared tasks.

- Interns may update task progress and submit work.

- Supervisors or team leads shall review submitted work.

- Task reassignment and approval functions shall be
  permission-controlled.

- Restricted client or project information shall not be exposed without
  authorization.

**11.5 Milestones and Delivery**

The system shall support milestone creation, delivery-date tracking,
client reviews, approvals, release notes, and delayed-task alerts.

**12. Timesheet Management**

The system shall allow employees, trainees, and interns to record time
spent on assigned work.

Functional requirements:

- Daily or weekly timesheet entry.

- Project and task association.

- Time spent and work description.

- Submission for review.

- Approval or rejection by authorized managers.

- Timesheet correction history.

- Estimated versus actual effort comparison.

- Employee-wise and project-wise reports.

Timesheets shall remain separate from attendance and movement records
while allowing authorized reporting across the modules.

**13. Quality Assurance and Issue Tracking**

**13.1 Issue Records**

Each issue shall include:

- Issue ID.

- Project and related task.

- Title and description.

- Severity and priority.

- Steps to reproduce.

- Screenshots or supporting files.

- Assigned developer or team.

- Reported date and target resolution date.

**13.2 Issue Workflow**

Suggested statuses:

- Open.

- Assigned.

- In Progress.

- Fixed.

- Ready for Testing.

- Reopened.

- Verified.

- Closed.

**13.3 QA Requirements**

- Authorized users may create and assign issues.

- Developers may update resolution details.

- QA staff may verify fixes and reopen unresolved issues.

- Managers may view open defects and resolution trends.

- Comments and issue history shall be retained.

- Interns shall only access issues relevant to their assigned
  responsibilities.

**14. Client Relationship Management (CRM)**

**14.1 Client Records**

Each client record shall include:

- Unique client ID.

- Company or individual name.

- Contact person and designation.

- Email and phone number.

- Address and business details.

- Lead source.

- Assigned business development executive.

- Client status.

- Communication history and notes.

**14.2 Lead and Enquiry Management**

The system shall support:

- Lead and enquiry creation.

- Requirement and budget recording.

- Lead assignment.

- Follow-up scheduling.

- Enquiry status tracking.

- Duplicate record detection.

- Lost-opportunity reasons.

- Conversion reporting.

**14.3 Sales Pipeline**

Suggested stages:

1.  New Lead.

2.  Contacted.

3.  Requirement Gathering.

4.  Proposal Preparation.

5.  Proposal Sent.

6.  Negotiation.

7.  Won.

8.  Lost.

Authorized administrators may configure the stages.

**14.4 Client Communication**

- Record calls, meetings, emails, and follow-up notes.

- Schedule reminders.

- Maintain communication history.

- Attach proposals, contracts, and supporting documents.

- Restrict sensitive client information.

**15. Proposals, Quotations, and Contracts**

**15.1 Proposal Management**

The system shall allow authorized users to:

- Create client proposals and quotations.

- Define scope, deliverables, timelines, and costs.

- Configure payment milestones and terms.

- Generate PDF documents.

- Maintain versions and revision history.

- Track proposal status.

**15.2 Contract Management**

The system shall support:

- Uploading signed contracts.

- Recording start and expiry dates.

- Renewal reminders.

- Linking contracts to clients and projects.

- Restricting confidential documents.

**15.3 Proposal-to-Project Conversion**

Approved proposals shall be convertible into projects and related
billing schedules, where applicable, without duplicate data entry.

**16. Finance and Accounts**

The finance module shall support operational financial tracking. Full
accounting functionality may be introduced separately if required.

**16.1 Invoice Management**

- Create client invoices.

- Link invoices to projects, contracts, or milestones.

- Record invoice number, date, due date, and amount.

- Support configurable taxes, discounts, and payment terms.

- Generate PDF invoices.

- Track Draft, Issued, Partially Paid, Paid, Overdue, and Cancelled
  statuses.

**16.2 Payment Tracking**

- Record payment date, amount, method, and reference.

- Support partial and multiple payments.

- Calculate outstanding balances.

- Maintain payment history.

- Generate client-wise receivables reports.

- Record authorized refunds and adjustments.

**16.3 Expense Management**

- Record company expenses.

- Categorize by type, department, or project.

- Upload supporting documents.

- Submit expenses for approval.

- Track approval and reimbursement status.

- Generate expense reports.

**16.4 Financial Reports**

The system shall provide:

- Monthly revenue summaries.

- Outstanding invoices.

- Client payment history.

- Project-wise income and expenses.

- Reimbursements.

- Expense category reports.

- Estimated versus actual project costs.

The system shall distinguish invoiced amounts, payments received,
outstanding receivables, and recorded expenses.

**17. Company Assets and Inventory**

**17.1 Asset Records**

Each asset record shall include:

- Asset ID and name.

- Category and serial number.

- Purchase date and cost.

- Warranty and service information.

- Assigned employee or department.

- Condition and status.

- Supporting documents.

**17.2 Asset Allocation**

The system shall support asset issuance, returns, transfers, damaged or
lost asset tracking, retirement, and warranty or maintenance reminders.

**18. Notifications and Reminders**

The system shall provide in-app notifications for:

- Task assignments and deadlines.

- Leave requests and decisions.

- Attendance irregularities.

- Movement submission and approval.

- Overdue movements and missing In-Time.

- Timesheet submission and approval.

- Project milestone reminders.

- Client follow-ups.

- Proposal and contract expiry.

- Invoice due dates and overdue payments.

- Payroll approvals.

- Employee and intern document expiry.

- Internship reviews and completion deadlines.

Email, SMS, WhatsApp, and push notifications may be integrated subject
to provider availability, authorization, and additional costs.

**19. Reports and Analytics**

The ERP shall provide searchable and filterable reports based on
authorized access.

**19.1 HR Reports**

- Employee directory and employment status.

- Attendance and working hours.

- Leave usage and balances.

- Payroll and stipend summaries.

- Intern records and attendance.

- Internship task progress and reviews.

**19.2 Movement Reports**

- Daily Movement Register.

- Employee-wise movement history.

- In-Time and Out-Time report.

- Duration-outside-office report.

- Late-return and overdue-movement report.

- Official and personal movement summaries.

- Pending approvals and correction history.

**19.3 Project Reports**

- Project progress and delivery performance.

- Task completion and overdue tasks.

- Employee workload and timesheets.

- QA issues and resolution status.

- Estimated versus actual effort.

**19.4 CRM and Financial Reports**

- Client enquiries and conversion rates.

- Proposal status and sales pipeline.

- Invoice and payment status.

- Outstanding receivables.

- Expenses and project profitability estimates.

Reports shall support date filters, relevant organizational filters, and
authorized exports to Excel, CSV, or PDF.

**20. User Management and Security**

**20.1 Authentication**

The system shall support:

- Secure login and logout.

- Password reset.

- Account activation and deactivation.

- Session management.

- Optional multi-factor authentication.

**20.2 Authorization**

- Role-based access control.

- Restricted access to confidential data.

- Separate approval permissions for sensitive transactions.

- Prevention of unauthorized changes to approved records.

- Configurable access for employees, trainees, and interns.

**20.3 Audit Trail**

The system shall record significant actions, including:

- Record creation, modification, and deletion.

- Attendance and movement corrections.

- Leave and payroll approvals.

- Financial transaction changes.

- Project and task updates.

- User-role and permission changes.

Audit logs shall capture the user, action, timestamp, and relevant
record wherever applicable.

**20.4 Data Protection**

The system shall provide:

- Secure data transmission.

- Appropriate password hashing and access controls.

- Regular database and file backups.

- Tested restoration procedures.

- Configurable data retention.

- Protection against unauthorized disclosure.

**21. System Administration and Configuration**

The Super Admin shall be able to configure:

- Company profile and logo.

- Departments and designations.

- User roles and permissions.

- Working days and office hours.

- Holidays and attendance rules.

- Leave categories and policies.

- Payroll and stipend components.

- Movement categories and approval rules.

- Project and task statuses.

- CRM pipeline stages.

- Invoice numbering and document templates.

- Notification settings.

- General system settings.

Important configuration changes shall be recorded in the audit trail.

**22. Search and Data Management**

The system shall provide global or module-level search for authorized
records.

Searchable information shall include:

- Employee and intern name or ID.

- Client name or contact.

- Project ID or title.

- Task ID or title.

- Invoice number.

- Proposal or contract reference.

- Movement records by employee and date.

The system shall support filtering, sorting, pagination, duplicate
checks, and controlled data import and export.

**23. Non-Functional Requirements**

**23.1 Platform**

- Web-based application.

- Responsive desktop and mobile interface.

- Support for modern browsers.

- Centralized database and file storage.

**23.2 Performance**

- Common pages and searches shall meet agreed response-time targets.

- Reports and exports shall be processed efficiently.

- Performance requirements shall be finalized during technical design.

**23.3 Scalability**

The system shall support growth in users, projects, departments,
clients, and modules without requiring a complete redesign.

**23.4 Reliability**

- Automated backups.

- Error logging and monitoring.

- Recovery procedures.

- Protection against accidental data loss.

**23.5 Maintainability**

- Modular architecture.

- Documented APIs and integrations.

- Maintainable source code.

- Separate development, testing, and production environments.

**24. Key Business Workflows**

**24.1 Employee or Intern Onboarding**

Record creation → Department and role assignment → Document collection →
Manager or supervisor assignment → Access activation → Dashboard access.

**24.2 Attendance and Movement**

Office check-in → Movement entry → Out-Time recording → Purpose and
expected return time → In-Time recording → Duration calculation →
Attendance and movement reporting.

**24.3 Leave Management**

Leave request → Manager or supervisor review → HR/Admin approval where
required → Leave balance update → Attendance update → Notification.

**24.4 Client to Project**

Lead creation → Requirement gathering → Proposal preparation → Client
approval → Project creation → Team assignment → Delivery → Invoicing →
Payment tracking.

**24.5 Project Delivery**

Project planning → Task allocation → Development → QA testing → Defect
resolution → Client review → Final delivery → Project closure.

**24.6 Monthly Payroll**

Attendance and leave verification → Payroll or stipend calculation →
Finance review → Management approval → Payment recording → Payslip or
statement generation.

**24.7 Expense Approval**

Expense submission → Supporting documents → Review → Approval or
rejection → Payment or reimbursement recording → Reporting.

**24.8 Internship Management**

Intern registration → Supervisor assignment → Learning objectives → Task
allocation → Work submission → Supervisor review → Progress evaluation →
Internship completion.

**25. Implementation Priorities**

**Phase 1 --- Core ERP**

- Authentication and role-based permissions.

- Staff, trainee, and intern management.

- Client management.

- Attendance and working hours.

- Movement Register with In-Time and Out-Time.

- Leave management.

- Project and task management.

- Dashboards and basic reports.

- Notifications and audit trail.

**Phase 2 --- HR and Commercial Operations**

- Payroll, stipends, and allowances.

- CRM lead pipeline.

- Proposals and contracts.

- Invoices and payment tracking.

- Expense management.

- Advanced reporting.

**Phase 3 --- Enhancements and Integrations**

- QA and issue-tracking enhancements.

- Asset and inventory management.

- Email and WhatsApp integrations.

- Advanced analytics.

- Accounting integrations.

- Optional mobile application or progressive web app.

The final implementation phases shall be confirmed after effort
estimation and management approval.

**26. Acceptance Criteria**

The ERP shall be considered ready for acceptance when:

1.  Authorized users can log in and access only permitted modules.

2.  Employee, intern, trainee, and client records can be created,
    updated, searched, and retrieved.

3.  Attendance and leave calculations follow approved company policies.

4.  Interns can view assigned tasks, submit work, and access permitted
    learning activities.

5.  Supervisors can review intern progress and record feedback.

6.  Employees and interns can record movements according to the approved
    workflow.

7.  Out-Time and In-Time are recorded accurately.

8.  Total time outside the office is calculated automatically.

9.  Multiple movements per day are supported.

10. Missing In-Time and overdue movements are flagged.

11. Movement approvals and corrections follow configured permissions.

12. Movement reports can be filtered and exported by authorized users.

13. Project managers can create projects, assign tasks, and track
    progress.

14. Client enquiries can be converted into proposals and projects.

15. Invoices, payments, and expenses can be recorded accurately.

16. Payroll and stipend calculations match approved test cases.

17. Notifications operate for agreed events.

18. Reports are consistent with underlying records.

19. Sensitive information is protected by role-based permissions.

20. Significant changes and approvals are captured in audit logs.

21. Backup and restoration procedures have been tested.

22. Critical defects identified during acceptance testing have been
    resolved.

23. User documentation and deployment handover are completed.

**27. Items Requiring Management Confirmation**

Before final development estimation and implementation, management shall
confirm:

1.  Whether the ERP will be web-only or include a mobile application.

2.  Final user roles and approval hierarchy.

3.  Official working days, office hours, and attendance rules.

4.  Leave policies for employees, trainees, and interns.

5.  Movement Register approval rules and permitted movement categories.

6.  Whether movement In-Time and Out-Time will be manually entered or
    recorded through a supported check-in interface.

7.  Whether movement records affect working-hour calculations.

8.  Payroll, stipend, and allowance calculation rules.

9.  Whether full accounting or operational finance is required.

10. Whether asset and inventory management is required in the initial
    release.

11. Required integrations, including email, WhatsApp, banking, and
    accounting software.

12. Existing data to be migrated.

13. Hosting, backup, security, and data retention requirements.

14. Internship review and completion procedures.

15. Project budget, delivery timeline, and implementation priorities.

**28. Expected Outcome**

The D4DX Internal ERP System shall provide a unified platform for
managing employees, trainees, interns, clients, projects, HR activities,
office movements, and commercial operations.

The system is expected to reduce manual administration, improve time
management and accountability, strengthen project coordination, maintain
accurate business records, and provide management with a consolidated
view of company performance.

**Final Deliverable:** A secure, scalable, user-friendly ERP system
tailored to D4DX Innovations LLP, developed in accordance with the
approved Functional Requirements Specification and agreed implementation
scope.
