"use client";

import { RequirePermission } from "@/components/Shell";
import { DataState, PageHeader } from "@/components/ui";
import { useApi } from "@/lib/auth";
import { useAsync } from "@/lib/useAsync";

function Duplicates() {
  const api = useApi();
  const q = useAsync(() => api.duplicates(), []);
  return (
    <>
      <PageHeader
        title="Duplicate candidates"
        description="Buildings where one property was registered without a unit number alongside unit-level properties — possible mis-registrations."
        actions={
          <button type="button" className="btn" onClick={q.reload}>
            Refresh
          </button>
        }
      />
      <div className="card flush">
        <DataState loading={q.loading} error={q.error} empty={!q.data?.length} emptyText="No duplicate candidates found." onRetry={q.reload}>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Duplicate candidates</caption>
              <thead>
                <tr>
                  <th scope="col">Group</th>
                  <th scope="col">Building</th>
                  <th scope="col">Properties</th>
                  <th scope="col">Identity keys</th>
                </tr>
              </thead>
              <tbody>
                {q.data?.map((d) => (
                  <tr key={`${d.project_id}-${d.district_id}-${d.group_code}-${d.building_code}`}>
                    <td>{d.group_code}</td>
                    <td>{d.building_code}</td>
                    <td className="num">{d.property_ids.length}</td>
                    <td>
                      <ul className="plain mono small">
                        {d.identity_keys.map((k) => (
                          <li key={k}>{k}</li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </div>
    </>
  );
}

export default function DuplicatesPage() {
  return (
    <RequirePermission permission="dispute.resolve">
      <Duplicates />
    </RequirePermission>
  );
}
