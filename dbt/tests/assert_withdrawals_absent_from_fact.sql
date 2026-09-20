select f.document_id
from {{ ref('fct_wellbeing_response') }} as f
join {{ ref('int_wellbeing_submission_latest') }} as l
    on f.document_id = l.document_id
where l.operation = 'delete'
