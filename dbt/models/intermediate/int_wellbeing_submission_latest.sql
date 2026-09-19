select *
from {{ ref('stg_wellbeing_submission_changes') }}
qualify row_number() over (
    partition by document_id
    order by source_version desc, source_updated_at desc, event_id desc
) = 1
